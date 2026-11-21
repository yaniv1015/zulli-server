#!/usr/bin/env python3
"""Fetch a YouTube video's transcript straight from YouTube. Free, no API key.

Usage:
  transcript.py <url-or-id> [--lang he,en] [--timestamps] [--translate he] [--json]
  transcript.py <url-or-id> --list

Needs: pip install youtube-transcript-api
"""
import argparse
import json
import re
import sys

ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
URL_PATTERNS = [
    r"(?:v=|/v/)([A-Za-z0-9_-]{11})",
    r"youtu\.be/([A-Za-z0-9_-]{11})",
    r"/(?:shorts|embed|live)/([A-Za-z0-9_-]{11})",
]


def video_id(value):
    value = value.strip()
    if ID_RE.match(value):
        return value
    for pattern in URL_PATTERNS:
        m = re.search(pattern, value)
        if m:
            return m.group(1)
    raise ValueError(f"Could not find a YouTube video ID in: {value}")


def ts(seconds):
    s = int(seconds)
    h, m, s = s // 3600, s % 3600 // 60, s % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def fail(message, code=1):
    print(f"Error: {message}", file=sys.stderr)
    sys.exit(code)


def main(argv=None):
    p = argparse.ArgumentParser(description="Fetch a YouTube transcript (free, no API key).")
    p.add_argument("video", help="YouTube URL or 11-character video ID")
    p.add_argument("--lang", default="he,en",
                   help="comma-separated preferred languages, first match wins (default: he,en)")
    p.add_argument("--timestamps", action="store_true", help="prefix each line with [m:ss]")
    p.add_argument("--translate", metavar="LANG", help="machine-translate the transcript via YouTube")
    p.add_argument("--json", action="store_true", help="print JSON (metadata + segments)")
    p.add_argument("--list", action="store_true", help="list the caption languages the video offers")
    a = p.parse_args(argv)

    try:
        vid = video_id(a.video)
    except ValueError as e:
        fail(str(e), 2)

    try:
        from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound
        from youtube_transcript_api import TranscriptsDisabled, VideoUnavailable
        from youtube_transcript_api import IpBlocked, RequestBlocked, YouTubeTranscriptApiException
    except ImportError:
        fail("missing dependency. Run: pip install youtube-transcript-api", 3)

    api = YouTubeTranscriptApi()
    langs = [l.strip() for l in a.lang.split(",") if l.strip()]
    try:
        tlist = api.list(vid)
        available = list(tlist)
        if a.list:
            rows = [{"language_code": t.language_code, "name": t.language,
                     "type": "auto" if t.is_generated else "manual",
                     "translatable": t.is_translatable} for t in available]
            if a.json:
                print(json.dumps({"video_id": vid, "languages": rows}, ensure_ascii=False, indent=2))
            else:
                for r in rows:
                    print(f"{r['language_code']}\t{r['type']}\t{r['name']}")
            return 0

        try:
            transcript = tlist.find_transcript(langs)
        except NoTranscriptFound:
            # Fall back to whatever the video has (manual tracks first).
            available.sort(key=lambda t: t.is_generated)
            if not available:
                raise
            transcript = available[0]
            print(f"Note: no {','.join(langs)} captions; using {transcript.language_code} instead.",
                  file=sys.stderr)

        if a.translate:
            if not transcript.is_translatable:
                fail(f"the {transcript.language_code} track cannot be translated by YouTube")
            transcript = transcript.translate(a.translate)

        fetched = transcript.fetch()
    except TranscriptsDisabled:
        fail("this video has captions turned off.")
    except NoTranscriptFound:
        fail("no transcript found for this video.")
    except VideoUnavailable:
        fail("video unavailable (private, removed, or wrong ID).")
    except (IpBlocked, RequestBlocked):
        fail("YouTube blocked this request (common from cloud/server IPs). "
             "Run it from your own computer, or try yt-dlp (see SKILL.md).", 4)
    except YouTubeTranscriptApiException as e:
        fail(str(e).strip().splitlines()[0] if str(e).strip() else type(e).__name__)
    except OSError as e:
        fail(f"network error: {e}", 4)

    segments = fetched.to_raw_data()
    if a.json:
        print(json.dumps({
            "video_id": vid,
            "language_code": fetched.language_code,
            "caption_type": "auto" if fetched.is_generated else "manual",
            "translated_to": a.translate,
            "text": " ".join(s["text"].replace("\n", " ") for s in segments),
            "segments": segments,
        }, ensure_ascii=False, indent=2))
    elif a.timestamps:
        for s in segments:
            print(f"[{ts(s['start'])}] {s['text'].replace(chr(10), ' ')}")
    else:
        print(" ".join(s["text"].replace("\n", " ") for s in segments))
    return 0


if __name__ == "__main__":
    sys.exit(main())
