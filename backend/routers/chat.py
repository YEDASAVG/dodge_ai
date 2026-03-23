"""Chat API router — SSE streaming endpoint."""

import asyncio

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from llm_service import process_message

router = APIRouter(prefix="/api", tags=["chat"])

# Simple concurrency limiter — max 3 simultaneous LLM calls
_chat_semaphore = asyncio.Semaphore(3)


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


@router.post("/chat")
async def chat(req: ChatRequest):
    if _chat_semaphore.locked():
        raise HTTPException(429, "Too many concurrent chat requests. Please wait.")
    async def event_stream():
        async with _chat_semaphore:
            async for event in process_message(req.message, req.history):
                yield event

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
