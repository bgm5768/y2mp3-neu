"""AI Downloader MCP Server

Exposes tools so an MCP client (e.g. Gemini) can search YouTube and pick a
single song URL. The host app then downloads the returned URL automatically.

Run:
    python -m pip install "mcp[cli]" google-generativeai yt-dlp
    python AI_Downloader/mcp_server.py
"""

import json
import os
import subprocess
from typing import List, Dict, Optional

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("ai-downloader")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

PLAYLIST_KEYWORDS = [
    "Playlist", "playlist", "플레이리스트", "모음", "Best of",
    "Top Tracks", "All Songs", "Full Album", "Collection", "compilation",
]


def is_playlist(title: str, url: str = "") -> bool:
    title_lower = (title or "").lower()
    for keyword in PLAYLIST_KEYWORDS:
        if keyword.lower() in title_lower:
            return True
    if "playlist" in (url or "").lower():
        return True
    return False


def youtube_search(query: str, limit: int = 5) -> List[Dict]:
    """Search YouTube via yt-dlp and return single-song candidates."""
    try:
        cmd = [
            "yt-dlp",
            f"ytsearch{limit}:{query}",
            "--dump-json",
            "--skip-download",
            "--no-warnings",
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        results = []
        for line in proc.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            title = data.get("title", "")
            url = data.get("webpage_url") or data.get("url") or ""
            if is_playlist(title, url):
                continue
            results.append({
                "title": title,
                "channel": data.get("channel") or data.get("uploader") or "",
                "url": url,
                "duration": data.get("duration") or 0,
                "thumbnail": data.get("thumbnail") or "",
            })
        return results[:limit]
    except Exception:
        return []


def gemini_pick(results: List[Dict], keyword: str) -> Optional[Dict]:
    if not results:
        return None
    if not GEMINI_API_KEY:
        return results[0]
    try:
        import google.generativeai as genai

        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel(GEMINI_MODEL)
        listing = "\n".join(
            f"{i + 1}. {r['title']} | {r['url']}" for i, r in enumerate(results)
        )
        prompt = (
            f"Pick the single best song for the keyword '{keyword}' from this "
            f"YouTube search result list. Return strict JSON only: "
            f'{{"index": number}}.\\n{listing}\\nDo not explain.'
        )
        resp = model.generate_content(prompt)
        text = (resp.text or "").strip()
        import re

        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            data = json.loads(m.group(0))
            idx = int(data.get("index", 1)) - 1
            if 0 <= idx < len(results):
                return results[idx]
    except Exception:
        pass
    return results[0]


@mcp.tool()
def search_youtube(keyword: str, limit: int = 5) -> str:
    """Search YouTube for single songs (playlists filtered out)."""
    results = youtube_search(keyword, limit)
    return json.dumps(results, ensure_ascii=False)


@mcp.tool()
def select_song(keyword: str, limit: int = 5) -> str:
    """Let Gemini pick the best single song and return its download URL."""
    results = youtube_search(keyword, limit)
    if not results:
        return json.dumps({"error": "no results"}, ensure_ascii=False)
    picked = gemini_pick(results, keyword)
    return json.dumps(
        {
            "title": picked.get("title", ""),
            "channel": picked.get("channel", ""),
            "url": picked.get("url", ""),
            "confidence": 0.95,
            "note": "Selected by Gemini via MCP",
        },
        ensure_ascii=False,
    )


if __name__ == "__main__":
    mcp.run()
