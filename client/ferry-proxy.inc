proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $fwd_host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $fwd_proto;
proxy_set_header X-Forwarded-Host $fwd_host;
proxy_set_header X-Real-IP $remote_addr;
# Stream large uploads/downloads instead of buffering them on disk.
proxy_request_buffering off;
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
