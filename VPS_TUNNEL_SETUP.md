# VPS Tunnel Setup

The Cloudflare DNS routes were created for:

- `clubcontent-api.davmn.net`
- `clubcontent-uploads.davmn.net`

They currently resolve to the existing `hermes-dev` tunnel, but the VPS still needs ingress rules so requests stop falling through to the tunnel's default `404`.

## Required Cloudflared Config

Edit `/etc/cloudflared/config.yml` on `hermes-dev` and add these entries above the final `http_status:404` rule:

```yaml
ingress:
  - hostname: hermes.davmn.net
    service: http://localhost:8787
  - hostname: sportsweathertracker.davmn.net
    service: http://localhost:3001
  - hostname: clubcontent-api.davmn.net
    service: http://localhost:4000
  - hostname: clubcontent-uploads.davmn.net
    service: http://localhost:9000
  - hostname: app-clubcontent.davmn.net
    service: http://localhost:3003
  - hostname: review-clubcontent.davmn.net
    service: http://localhost:3002
  - service: http_status:404
```

## Restart

After editing the file:

```bash
sudo systemctl restart cloudflared
sudo systemctl status cloudflared
```

## Expected Public Endpoints

- API: `https://clubcontent-api.davmn.net`
- Upload signing target base: `https://clubcontent-uploads.davmn.net`
- Submitter app: `https://app-clubcontent.davmn.net`
- Reviewer console: `https://review-clubcontent.davmn.net`

## Notes

- I could create the DNS routes remotely.
- I could not edit `/etc/cloudflared/config.yml` from here because the server requires interactive `sudo`.
- Until the ingress entries are added and `cloudflared` is restarted, the new hostnames will not serve the app correctly.
