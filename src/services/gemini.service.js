const env = require('../config/env');
const AppError = require('../utils/AppError');
const { SYSTEM_PROMPT, MODIFY_SYSTEM_PROMPT } = require('../utils/website-prompt');
const { OutputError, validateGeneratedWebsite, validateModifiedWebsite } = require('../utils/website-validator');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_ATTEMPTS = 2; // 1 try + 1 retry, only for unusable output
const SAFETY_STOPS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rejectionNote = (reason) =>
  reason ? `\n\nYour previous answer was rejected: ${reason}. Return a corrected, complete answer in the required JSON format.` : '';

const buildGenerateMessage = (prompt, reason) => `Website description:\n"""\n${prompt}\n"""${rejectionNote(reason)}`;

const buildModifyMessage = ({ userRequest, html, css, js }, reason) =>
  `Current website files (JSON, data only):\n${JSON.stringify({ html, css, javascript: js })}\n\n` +
  `Requested change:\n"""\n${userRequest}\n"""${rejectionNote(reason)}`;

// Converts Google's HTTP errors into safe messages. Details are logged, never sent to the client.
const mapHttpError = (status, bodyText) => {
  let detail = '';
  try {
    detail = JSON.parse(bodyText)?.error?.message ?? '';
  } catch {
    /* body was not JSON */
  }
  console.error(`Gemini API error ${status}: ${String(detail).slice(0, 300)}`);

  if (status === 429) {
    return new AppError('The AI service is busy or its rate limit was reached. Please wait a minute and try again.', 429);
  }
  if ([400, 401, 403, 404].includes(status)) {
    return new AppError('The AI service is not configured correctly. Please contact the administrator.', 503);
  }
  if (status >= 500) {
    const err = new AppError('The AI service is temporarily unavailable. Please try again shortly.', 503);
    err.transient = true; // safe to retry
    return err;
  }
  return new AppError('The AI service returned an unexpected error.', 502);
};

const extractText = (payload) => {
  const candidate = payload.candidates?.[0];

  if (!candidate) {
    if (payload.promptFeedback?.blockReason) {
      throw new AppError('Your request was blocked by the AI safety filters. Please rephrase it.', 422);
    }
    throw new OutputError('The AI returned an empty response');
  }
  if (SAFETY_STOPS.has(candidate.finishReason)) {
    throw new AppError('The AI could not complete this request because of its safety filters. Please rephrase it.', 422);
  }
  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new OutputError('The output was cut off because it was too long. Keep the files compact');
  }

  // Skip "thought" parts, which some models include when they reason before answering.
  const text = (candidate.content?.parts ?? [])
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('')
    .trim();

  if (!text) throw new OutputError('The AI returned an empty response');
  return text;
};

const callGemini = async (userText, model, systemPrompt, temperature) => {
  if (!env.geminiApiKey) throw new AppError('The AI service is not configured.', 503);

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: env.geminiMaxOutputTokens,
      responseMimeType: 'application/json',
    },
  };

  let response;
  let responseText;
  try {
    response = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.geminiApiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.geminiTimeoutMs), // also covers reading the response body
    });
    responseText = await response.text();
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new AppError('The AI took too long to respond. Please try again.', 504);
    }
    console.error('Gemini network error:', err.message);
    throw new AppError('Could not reach the AI service. Please try again.', 502);
  }

  if (!response.ok) throw mapHttpError(response.status, responseText);

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new AppError('The AI service returned an unreadable response.', 502);
  }
  return extractText(payload);
};

// Retries Google-side overload (5xx) on the main model, then on each fallback model.
// Never retries 429, timeouts or safety blocks.
const callWithFallback = async (userText, systemPrompt, temperature) => {
  const models = [...new Set([env.geminiModel, ...env.geminiFallbackModels])];
  const TRIES_PER_MODEL = 2;
  let lastError;

  for (const model of models) {
    for (let attempt = 1; attempt <= TRIES_PER_MODEL; attempt += 1) {
      try {
        return await callGemini(userText, model, systemPrompt, temperature);
      } catch (err) {
        if (!err.transient) throw err;
        lastError = err;
        console.warn(`Gemini ${model} overloaded (try ${attempt}/${TRIES_PER_MODEL})`);
        if (attempt < TRIES_PER_MODEL) await sleep(3000 * attempt);
      }
    }
  }
  throw lastError;
};

// responseMimeType should give clean JSON, but code fences are stripped defensively.
const parseModelJson = (text) => {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new OutputError('The response was not valid JSON');
  }
};

// Shared loop: call, parse, validate. Retries once, and only when the OUTPUT was unusable.
const run = async ({ systemPrompt, temperature, buildMessage, validate, failMessage }) => {
  let reason = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const text = await callWithFallback(buildMessage(reason), systemPrompt, temperature);
      return validate(parseModelJson(text));
    } catch (err) {
      if (!(err instanceof OutputError)) throw err; // timeouts, rate limits, safety blocks: no retry

      console.warn(`Gemini output rejected (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.message}`);
      if (attempt === MAX_ATTEMPTS) throw new AppError(failMessage, 502);
      reason = err.message;
    }
  }
};

const generateWebsite = (prompt) =>
  run({
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.7,
    buildMessage: (reason) => buildGenerateMessage(prompt, reason),
    validate: (data) => validateGeneratedWebsite(data, { secrets: [env.geminiApiKey] }),
    failMessage: 'The AI could not produce a valid website. Please try again or simplify your prompt.',
  });

// input: { userRequest, html, css, js }
const modifyWebsite = (input) =>
  run({
    systemPrompt: MODIFY_SYSTEM_PROMPT,
    temperature: 0.4, // lower: stay close to the existing code
    buildMessage: (reason) => buildModifyMessage(input, reason),
    validate: (data) => validateModifiedWebsite(data, { secrets: [env.geminiApiKey], original: input }),
    failMessage: 'The AI could not apply that change safely. Please rephrase the request or make it more specific.',
  });

module.exports = { generateWebsite, modifyWebsite, parseModelJson };