export interface CapturedCtclRequest {
  url: string;
  method: string;
  headers: Headers;
  body: Uint8Array;
}

export type FakeCtclResponder =
  | Response
  | ((request: CapturedCtclRequest) => Response | Promise<Response>);

export interface FakeCtclFetch {
  fetch: typeof globalThis.fetch;
  requests: CapturedCtclRequest[];
}

export function createFakeCtclFetch(responders: FakeCtclResponder[]): FakeCtclFetch {
  const queue = [...responders];
  const requests: CapturedCtclRequest[] = [];

  const fakeFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? new Uint8Array()
        : new Uint8Array(await request.clone().arrayBuffer());

    const captured: CapturedCtclRequest = {
      url: request.url,
      method: request.method,
      headers: new Headers(request.headers),
      body,
    };
    requests.push(captured);

    const responder = queue.shift();
    if (responder === undefined) {
      throw new Error(`unexpected CTCL fetch request: ${request.method} ${request.url}`);
    }
    return typeof responder === 'function' ? responder(captured) : responder;
  };

  return { fetch: fakeFetch as typeof globalThis.fetch, requests };
}
