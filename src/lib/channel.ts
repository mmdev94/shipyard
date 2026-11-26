// A second app from the same repo: Shipyard's v2 preview runs from the `v2`
// branch at its own address while `main` stays the production site. The
// generated workflow is rewritten so every piece of the app's identity has its
// own name — secrets, variables, the deployment records and the concurrency
// group — and nothing it does can reach the production app.

/** Rewrites a generated workflow to deploy a separate app for `channel` (e.g. "v2"). */
export function channelWorkflow(yaml: string, channel: string): string {
  if (!/^[a-z0-9-]+$/.test(channel)) throw new Error(`Bad channel name: ${channel}`)
  const up = channel.toUpperCase().replace(/-/g, '_')
  return yaml
    .replace(/\bMSCOMPUTER_APP_SECRET\b/g, `MSCOMPUTER_APP_SECRET_${up}`)
    .replace(/\bMSCOMPUTER_TOML\b/g, `MSCOMPUTER_TOML_${up}`)
    .replace(/environment=ms-computer&/g, `environment=ms-computer-${channel}&`)
    .replace(/environment: "ms-computer"/g, `environment: "ms-computer-${channel}"`)
    .replace(/production_environment: true/g, 'production_environment: false')
    .replace(/'ms-computer-deploy'/g, `'ms-computer-${channel}-deploy'`)
    .replace(/group: ms-computer-deploy$/m, `group: ms-computer-${channel}-deploy`)
    .replace(/^name: Deploy to ms\.computer$/m, `name: Deploy the ${channel} preview to ms.computer`)
}
