import os
from typing import Dict

import httpx
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse


UPSTREAM = os.environ.get("VLLM_UPSTREAM", "http://127.0.0.1:8001").rstrip("/")
PORT = int(os.environ.get("PORT", "8000"))

app = FastAPI(title="npc-sim vLLM proxy")


def forward_headers(request: Request) -> Dict[str, str]:
    skipped = {"host", "content-length", "connection"}
    return {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in skipped
    }


async def readiness_payload():
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{UPSTREAM}/health")
        if 200 <= response.status_code < 300:
            return JSONResponse({"status": "ok"}, status_code=200)
    except httpx.HTTPError:
        pass
    return JSONResponse({"status": "initializing"}, status_code=503)


@app.get("/")
async def root():
    return await readiness_payload()


@app.get("/health")
async def health():
    return await readiness_payload()


@app.get("/ping")
async def ping():
    return await readiness_payload()


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy(path: str, request: Request):
    body = await request.body()
    url = f"{UPSTREAM}/{path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    try:
        async with httpx.AsyncClient(timeout=None) as client:
            upstream_response = await client.request(
                request.method,
                url,
                content=body,
                headers=forward_headers(request),
            )
    except httpx.ConnectError:
        return JSONResponse(
            {
                "status": 503,
                "title": "Service Unavailable",
                "detail": "vLLM upstream is still initializing",
            },
            status_code=503,
        )

    headers = {
        key: value
        for key, value in upstream_response.headers.items()
        if key.lower() not in {"content-encoding", "transfer-encoding", "connection"}
    }
    return Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers=headers,
        media_type=upstream_response.headers.get("content-type"),
    )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
