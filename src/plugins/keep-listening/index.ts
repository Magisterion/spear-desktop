import { createPlugin } from '@/utils';

let timer: ReturnType<typeof setInterval> | undefined;
export default createPlugin({
  name: () => 'Keep listening',
  description: () =>
    'Confirm the inactivity prompt so long listening sessions can continue.',
  restartNeeded: false,
  config: { enabled: true },
  renderer: {
    start() {
      clearInterval(timer);
      timer = setInterval(() => {
        const prompt = document.querySelector<HTMLElement>(
          'ytmusic-you-there-renderer',
        );
        if (!prompt || prompt.getClientRects().length === 0) return;
        prompt
          .querySelector<HTMLElement>(
            '#confirm-button button, #confirm-button, yt-button-renderer button',
          )
          ?.click();
      }, 1500);
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  },
});
