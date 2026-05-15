# Plugin Privacy

TikTok Assistant plugins run locally on the user's machine.

CoBrowser stores browser state under the user's local CoBrowser profile directory and treats browser storage as opaque browser-owned state. It must not read cookies, passwords, localStorage, sessionStorage, token stores, or browser databases.

TikTok monitor writes local monitoring data under `monitoring_data/` unless the operator explicitly configures Feishu alerts or Feishu Base sync. Local monitoring data is ignored by git and is not included in plugin release packages.

Do not commit browser profiles, account tokens, cookies, Feishu credentials, local runtime folders, or generated provider output.

