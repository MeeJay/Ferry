// Guide served to AI agents by the MCP tool get_guide. Keep it in step with mcp.ts.

export const AGENT_GUIDE = `# Ferry — guide for AI agents

Ferry is a self-hosted file-sharing server (like WeTransfer). Through your access you send files
to it and get links back: a **page** for humans and a **direct download** URL that curl can fetch
on any machine. Typical jobs:
- "send this build to Ferry, then install it on these machines" (upload from where you run, the
  machines download the direct link);
- "get me the logs of that PC" (the file is on a machine you reach through a remote shell or an
  RMM tool: the upload runs there, you get the links back);
- "send this report to alice@example.com, password-protected, for 48 h".

## Your access
- It acts as the Ferry account that created it, with that account's current limits (file size,
  quota, expiry, public links). \`whoami\` shows them and what the instance offers (e-mail…).
- Rights: \`upload\` (create_upload, get_upload, finish_upload, cancel_upload, update_share,
  send_share), \`read\` (list_shares, get_share), \`delete\` (delete_share).
- You may change, e-mail or delete only the shares sent by an AI agent (source \`mcp\`). The
  human's own shares are read-only for you: ask the human to change them in Ferry.

## Choosing the options (decide from the request and the situation)
| Need | Option |
|---|---|
| Machines download it with curl, no account | \`visibility: public\` (default when allowed) |
| Only people with a Ferry account | \`visibility: private\` (curl cannot fetch it) |
| Sensitive file shared outside | \`password\` + short \`expires_hours\` |
| N machines / one recipient | \`max_downloads\` = N (each download counts) |
| The human wants to know when it is fetched | \`notify_on_download\` (needs e-mail) |
| Someone must receive it by mail | \`send_share\` after publishing (needs e-mail) |
| Fix a mistake later | \`update_share\` (title, password, expiry, limit, visibility…) |
Defaults that are always right: the shortest expiry that fits the job, a download limit when the
number of downloads is known, no password for machine-to-machine transfers inside the company
unless asked, a password for anything personal or confidential that leaves the company.
Never invent recipients: e-mail only addresses the human gave you.

## Sending files
1. \`create_upload\` with the plain file names and, when you know them, their sizes in bytes
   (\`stat -c%s file\` on Linux, \`stat -f%z\` on macOS, \`(Get-Item f).Length\` in PowerShell),
   plus the options above and \`upload_window_minutes\` (how long the upload URLs work: 5 min to
   24 h, default 2 h; size it to the transfer).
2. Send each file to ITS \`upload_url\` as the raw request body (NOT multipart, no -F):
     bash:     curl --fail-with-body -sS -T ./build.zip "<upload_url>"
     Windows:  curl.exe --fail-with-body -sS -T C:\\path\\build.zip "<upload_url>"
   Files can go in parallel. The answer is JSON; the answer of the LAST file carries \`share\`
   with \`download\` (direct link) and \`page\`.
3. Otherwise \`get_upload\` shows the progress and, once published, the links. \`finish_upload\`
   publishes with what was received; \`cancel_upload\` abandons.

### Upload URLs are single-use tokens
- One URL per file, valid for that file only. It stops working as soon as that file is
  complete, when the share is published or cancelled, or when the window closes.
- It is the only credential the sending machine needs: NEVER copy your access key or token to
  another machine.
- Keep URLs out of answers, tickets, share messages and logs you show. If one may have leaked,
  or the window closed, \`get_upload\` with \`renew_urls: true\` issues new ones and kills the old
  ones (bytes already received are kept).
- The size you announced must match what you send, and the account limits apply.

## Large files (proxy limits, unstable links, time-limited commands)
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

The same in Windows PowerShell (5.1 or later, no curl needed). It prints Ferry's answer to the
last piece, which carries \`share\` when it was the last file:

    $f='C:\\path\\big.iso'; $url='<upload_url>'; $cs=50MB
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    [Net.ServicePointManager]::Expect100Continue=$false
    $size=(Get-Item -LiteralPath $f).Length
    $off=[long](Invoke-RestMethod -Uri $url -UseBasicParsing).offset
    $in=[IO.File]::Open($f,'Open','Read','ReadWrite'); $last=$null
    try { while ($off -lt $size) {
      $n=[int][Math]::Min($cs,$size-$off); $buf=New-Object byte[] $n
      $in.Position=$off; $r=0; while ($r -lt $n) { $r+=$in.Read($buf,$r,$n-$r) }
      $q=[Net.WebRequest]::Create($url); $q.Method='PUT'; $q.Timeout=900000
      $q.ContentLength=$n; $q.Headers.Add('Content-Range',"bytes $off-$($off+$n-1)/$size")
      $s=$q.GetRequestStream(); $s.Write($buf,0,$n); $s.Close()
      $res=$q.GetResponse(); $last=(New-Object IO.StreamReader $res.GetResponseStream()).ReadToEnd()
      $res.Close(); $off+=$n } } finally { $in.Close() }
    $last

- A piece must start at the current offset (otherwise HTTP 409 with the right \`offset\`).
- Re-sending a piece already stored is acknowledged without effect: retrying is safe.
- An empty file is sent in one request, without Content-Range.

## Sending a file that is on another machine
When the file sits on a machine you reach through a remote shell or an RMM tool (Obliance
\`run_command\` / \`shell_open\`, ssh…), run the upload ON that machine:
- It needs only the \`upload_url\` (never your access key).
- Windows: \`curl.exe\` exists from Windows 10 1803 / Server 2019; otherwise, or for large files,
  use the PowerShell loop above. Linux / macOS: curl, or the bash loop.
- Remote commands often have a time limit. Prefer pieces: when a command is cut off, run the
  same loop again, it resumes at the stored offset. \`get_upload\` shows the progress from here.
- A folder: archive it first (Windows 10+: \`tar.exe -a -cf C:\\Temp\\logs.zip -C C:\\App logs\`,
  Linux: \`tar czf /tmp/logs.tar.gz -C /var/log app\`) and send the archive. A file locked by a
  running program may refuse to open: copy it first, send the copy, delete the copy after.
- The upload URL ends up in that tool's command history: it is single-use and short-lived, and
  \`cancel_upload\` kills it if you abandon.
- Then give the human the \`page\` link (or \`download\` for a tool or another machine).

## Downloading on other machines
The \`download\` link of a **public** share needs no account:
    Linux / macOS:  curl -fL --retry 3 -o /tmp/build.zip "<download>"
    Windows 10+:    curl.exe -fL --retry 3 -o C:\\Temp\\build.zip "<download>"
    PowerShell:     Invoke-WebRequest -Uri "<download>" -OutFile C:\\Temp\\build.zip -UseBasicParsing
- Password-protected: add the header, e.g. \`curl -fL -H "X-Share-Password: <password>" -o …\`
  (PowerShell: \`-Headers @{'X-Share-Password'='<password>'}\`).
- With several files, the share's \`download\` is a zip of all of them; each entry of \`files\`
  has its own \`download\`.
- Ranges are supported: \`curl -C -\` resumes a broken download.
- Each machine counts as one download: set \`max_downloads\` to the number of machines, or leave
  it unlimited when unsure. Check \`size\` after downloading.
- A **private** share needs a Ferry sign-in: it cannot be fetched by curl on a machine.
- Errors: 404 unknown link, 410 expired / download limit reached, 401 private or wrong password.

## Good practice
- Send only what the human asked for. Never send secrets, credentials or personal data unless
  explicitly asked; prefer the shortest expiry, a download limit, and a password when it leaves
  the company.
- Give the human the \`page\` link (it shows the files, the expiry and a download button), and
  use \`download\` for machines. Give a password in a separate line, never inside the share.
- Clean up when the job is done and the human agrees: \`delete_share\` (needs the delete right).
`;
