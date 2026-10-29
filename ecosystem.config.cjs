module.exports = {
  apps: [
    {
      name: 'sps-lyric-api',
      cwd: __dirname,
      script: './scripts/run-public-server.sh',
      interpreter: '/bin/sh',
      env: {
        HOST: '127.0.0.1',
        PORT: '8791',
        ADMIN_MODE: 'false',
        REVIEWER_TOKEN: '',
        PUBLIC_BASE_URL: 'https://lyrics.lemmon.cn',
        GITHUB_ISSUES_URL: 'https://github.com/onvno/sps-lyric-api/issues',
        NODE_ENV: 'production',
      },
      autorestart: true,
      restart_delay: 2000,
      watch: false,
    },
    {
      name: 'sps-lyric-api-tunnel',
      cwd: __dirname,
      script: './scripts/run-cloudflared-tunnel.sh',
      interpreter: '/bin/zsh',
      autorestart: true,
      restart_delay: 5000,
      watch: false,
    },
  ],
};
