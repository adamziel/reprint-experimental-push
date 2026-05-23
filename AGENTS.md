Right now this setup exposes one HTTP port from the sandbox: 8080.

Never expose the local network by starting or using a remote tunneling service
such as ngrok, cloudflared tunnels, localtunnel, serveo, localhost.run,
lhr.life, Tailscale Funnel, or similar tools. Use only the sandbox-provided
8080 ingress and local-only proxies inside the sandbox.

Pull request titles, branch names, descriptions, review comments, and status
comments must not mention Codex or include generated-by attribution.

