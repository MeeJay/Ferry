// Guide served to AI agents by the MCP tool get_guide. Keep it in step with mcp.ts.

export const AGENT_GUIDE = `# Ferry — guide for AI agents

Ferry is a self-hosted file-sharing server (like WeTransfer). Through your access key you send
files to it and get links back: a **page** for humans and a **direct download** URL that curl can
fetch on any machine. Typical job: "send this build to Ferry, then install it on these machines"
(you upload from where you run, then the machines download the direct link).

## Your access key
- It acts as the Ferry account that created it, with that account's current limits (file size,
  quota, expiry, public links). \`whoami\` shows them. It cannot change the account.
- Rights: \`upload\` (create_upload, get_upload, finish_upload, cancel_upload), \`read\`
  (list_shares, get_share), \`delete\` (delete_share: only shares sent by an agent).

## Sending files
1. \`create_upload\` with the plain file names and, when you know them, their sizes in bytes
   (\`stat -c%s file\` on Linux, \`stat -f%z\` on macOS, \`(Get-Item f).Length\` in PowerShell).
   Choose \`expires_hours\` and \`max_downloads\` to fit the task (e.g. 24 h, number of machines).
2. Send each file to its \`upload_url\` as the raw request body (NOT multipart, no -F):
     bash:     curl --fail-with-body -sS -T ./build.zip "<upload_url>"
     Windows:  curl.exe --fail-with-body -sS -T C:\\path\\build.zip "<upload_url>"
   Each file can go in parallel. The answer is JSON; the answer of the LAST file carries
   \`share\` with \`download\` (direct link) and \`page\`.
3. Otherwise \`get_upload\` shows the progress and, once published, the links. \`finish_upload\`
   publishes with what was received; \`cancel_upload\` abandons.
- Upload URLs are secrets (anyone holding one may send that file): keep them out of answers,
  tickets and logs. They die when the upload is published or after 24 hours.
- The size you announced must match what you send, and the account limits apply.

## Large files (proxy limits, unstable links)
A single request is the simplest. If it is refused for its size (HTTP 413 from a proxy), times
out or breaks, send the file in pieces with \`Content-Range\`; each piece is appended, so you can
resume. \`GET <upload_url>\` answers \`{ offset, size, done }\` (bytes already stored).
whoami gives the piece size to use (\`upload.pieceSizeIfProxyLimits\`). In bash:

    f=./big.iso; url="<upload_url>"; cs=$((50*1024*1024))
    size=$(stat -c%s "$f")                       # macOS: stat -f%z "$f"
    off=$(curl -sS "$url" | sed -E 's/.*"offset":([0-9]+).*/\\1/')
    while [ "$off" -lt "$size" ]; do
      end=$((off+cs-1)); [ "$end" -ge "$size" ] && end=$((size-1))
      tail -c +$((off+1)) "$f" | head -c $((end-off+1)) > /tmp/ferry.piece
      curl --fail-with-body -sS -X PUT -H "Content-Range: bytes $off-$end/$size" \\
           --data-binary @/tmp/ferry.piece "$url" || break
      off=$((end+1))
    done; rm -f /tmp/ferry.piece

- A piece must start at the current offset (otherwise HTTP 409 with the right \`offset\`).
- Re-sending a piece already stored is acknowledged without effect: retrying is safe.
- An empty file is sent in one request, without Content-Range.

## Downloading on other machines
The \`download\` link of a **public** share needs no credential:
    Linux / macOS:  curl -fL --retry 3 -o /tmp/build.zip "<download>"
    Windows 10+:    curl.exe -fL --retry 3 -o C:\\Temp\\build.zip "<download>"
    PowerShell:     Invoke-WebRequest -Uri "<download>" -OutFile C:\\Temp\\build.zip -UseBasicParsing
- With several files, the share's \`download\` is a zip of all of them; each entry of \`files\`
  has its own \`download\`.
- Ranges are supported: \`curl -C -\` resumes a broken download.
- Each machine counts as one download: set \`max_downloads\` to the number of machines, or leave
  it unlimited when unsure. Check \`size\` after downloading.
- A **private** share needs a Ferry sign-in: it cannot be fetched by curl on a machine. Use a
  public one with a short expiry for machine downloads.
- Errors: 404 unknown link, 410 expired / download limit reached, 401 private.

## Good practice
- Send only what the human asked for. Never send secrets, credentials or personal data unless
  explicitly asked; prefer the shortest expiry and a download limit.
- Give the human the \`page\` link (it shows the files, the expiry and a download button), and
  use \`download\` for machines.
- Clean up when the job is done and the human agrees: \`delete_share\` (needs the delete right).
`;
