import { AppError } from './errors.js';

export async function requestJson(request, signal) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json' ||
      request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
    throw new AppError('invalid_content_type', 'Send this search as JSON.', 415);
  }
  if (Number(request.headers['content-length']) > 4096) throw new AppError('request_too_large', 'Keep the search request under 4 KB.', 413);
  const chunks = await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const cleanup = () => {
      request.off('data', onData); request.off('end', onEnd); request.off('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const fail = error => { cleanup(); request.pause(); reject(error); };
    const onData = chunk => {
      size += chunk.length;
      if (size > 4096) fail(new AppError('request_too_large', 'Keep the search request under 4 KB.', 413));
      else chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolve(chunks); };
    const onError = () => fail(new AppError('invalid_request', 'The request body could not be read. Send a complete JSON search body.'));
    const onAbort = () => fail(new AppError('request_timeout', 'The search took too long. Send the search again later.', 408));
    request.on('data', onData); request.on('end', onEnd); request.on('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new AppError('invalid_json', 'Send a valid JSON search request.'); }
}

export function json(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
