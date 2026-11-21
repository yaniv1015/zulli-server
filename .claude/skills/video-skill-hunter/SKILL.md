---
name: video-skill-hunter
description: Use when the user shares a video (Instagram reel, TikTok, YouTube short, screen recording) that shows or mentions Claude skills, and wants those skills found, explained and installed. Watches the video, lists every skill shown, fetches the original from GitHub when the full name is visible or rebuilds it when it is not, summarizes each one, and installs only what the user approves.
---

# Video Skill Hunter

Turn a video that shows Claude skills into installed, vetted skills.
Talk to the user in casual Israeli Hebrew unless they write in another language.

## 1. Get the video
- Uploaded file → use it directly.
- Google Drive link or file name → download it with the Google Drive tools.
- Instagram/TikTok link → this cloud session cannot log in to Instagram. Ask the user
  to upload the file, or to connect their computer so Claude in Chrome can open it.
- No video yet → ask for it and stop.

## 2. Watch it
Run the `video-analyzer` skill on the video. From the transcript and frames, collect
every skill that is shown or mentioned: the name exactly as it appears, what the video
says it does, and the timestamp. Note whether the full name is clearly readable.

## 3. Resolve each skill

**Full name visible → bring the original.**
1. Search GitHub: `gh api -X GET search/repositories -f q='<name> skill'` and
   `gh api -X GET search/code -f q='filename:SKILL.md <name>'`.
2. Confirm it is the right repo (name, description and content match the video).
3. Record stars, last update and license. Do not assume it is good because it was in
   the video: flag repos with few stars, no recent updates or no license.
4. Read `SKILL.md` and every script in it before proposing it. Stop and report if it
   sends data to unknown hosts, asks for keys or passwords, runs downloaded code, or
   does anything the description does not explain.

**Name cut off, blurry or missing → rebuild it.**
Draft our own version with the `skill-creator` skill based on what the video shows,
adapted to this project. Label it clearly as a rebuild, not the original.

Before either path, check the user's existing skills (ListSkills) for overlap.

## 4. Summarize and ask — never install before approval
For each skill, give a short card:
- **שם** + source (GitHub repo with stars, or "שחזור שלי")
- **מה הוא עושה** — one or two sentences
- **איך זה יעבוד אצלנו** — concrete use in this project / the user's content work
- **חפיפה** — any existing skill that already covers it
- **אזהרות** — anything found in the security read

Then ask which to install (AskUserQuestion, multiSelect). Each skill is approved or
rejected on its own.

## 5. Install what was approved
- Available in the skills library → show the add card (SuggestSkills).
- From GitHub or rebuilt → save under `.claude/skills/<skill-name>/` (keep the
  original license file and credit the source repo), commit, and push to the
  working branch.
- Report what was installed, from where, and anything that was skipped and why.
