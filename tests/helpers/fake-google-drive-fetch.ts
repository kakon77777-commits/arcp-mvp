export interface CapturedGoogleDriveRequest {
  url: string;
  method: string;
  headers: Headers;
  body: Uint8Array;
}

export type FakeGoogleDriveResponder =
  | Response
  | ((request: CapturedGoogleDriveRequest) => Response | Promise<Response>);

export interface FakeGoogleDriveFetch {
  fetch: typeof globalThis.fetch;
  requests: CapturedGoogleDriveRequest[];
}

export function createFakeGoogleDriveFetch(
  responders: FakeGoogleDriveResponder[],
): FakeGoogleDriveFetch {
  const queue = [...responders];
  const requests: CapturedGoogleDriveRequest[] = [];

  const fakeFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? new Uint8Array()
        : new Uint8Array(await request.clone().arrayBuffer());
    const captured: CapturedGoogleDriveRequest = {
      url: request.url,
      method: request.method,
      headers: new Headers(request.headers),
      body,
    };
    requests.push(captured);

    const responder = queue.shift();
    if (responder === undefined) {
      throw new Error(`unexpected fetch request: ${request.method} ${request.url}`);
    }
    return typeof responder === 'function' ? responder(captured) : responder;
  };

  return {
    fetch: fakeFetch as typeof globalThis.fetch,
    requests,
  };
}
