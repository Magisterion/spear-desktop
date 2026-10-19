import {
  createResource,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { css } from 'solid-styled-components';
import { cacheNoArgs } from '@/providers/decorators';
import { WindowController } from './WindowController';
import type { InAppMenuConfig } from '../constants';
import type { RendererContext } from '@/types/contexts';

const titleStyle = cacheNoArgs(
  () => css`
    -webkit-app-region: drag;
    box-sizing: border-box;

    position: fixed;
    top: 0;
    z-index: 10000000;

    width: 100%;
    height: var(--menu-bar-height, 32px);

    display: flex;
    flex-flow: row;
    justify-content: flex-start;
    align-items: center;
    gap: 4px;

    color: #f1f1f1;
    font-size: 12px;
    padding: 4px 4px 4px var(--offset-left, 4px);
    background-color: var(--titlebar-background-color, #030303);
    user-select: none;

    transition:
      opacity 200ms ease 0s,
      transform 300ms cubic-bezier(0.2, 0, 0.6, 1) 0s,
      background-color 300ms cubic-bezier(0.2, 0, 0.6, 1) 0s;

    &[data-macos='true'] {
      padding: 4px 4px 4px 74px;
    }

    ytmusic-app:has(ytmusic-player[player-ui-state='FULLSCREEN'])
      ~ &:not([data-show='true']) {
      transform: translateY(calc(-1 * var(--menu-bar-height, 32px)));
    }
  `,
);

export type TitleBarProps = {
  ipc: RendererContext<InAppMenuConfig>['ipc'];
  isMacOS?: boolean;
  enableController?: boolean;
  initialCollapsed?: boolean;
};
export const TitleBar = (props: TitleBarProps) => {
  const [pinned, setPinned] = createSignal(false);
  const [mouseY, setMouseY] = createSignal(0);
  const [isMaximized, { refetch: refetchMaximize }] = createResource(
    async () => (await props.ipc.invoke('window-is-maximized')) as boolean,
  );
  const handleToggleMaximize = async () => {
    await props.ipc.invoke(
      isMaximized() ? 'window-unmaximize' : 'window-maximize',
    );
    await refetchMaximize();
  };
  const handleMinimize = () => props.ipc.invoke('window-minimize');
  const handleClose = () => props.ipc.invoke('window-close');
  const listener = (event: MouseEvent) => setMouseY(event.clientY);
  onMount(() => {
    void window.ipcRenderer
      .invoke('classic:navigate', 'pin-state')
      .then((value) => setPinned(!!value));
    window.ipcRenderer.on('classic:pin-state', (_event, value) =>
      setPinned(!!value),
    );
    window.addEventListener('mousemove', listener);
    props.ipc.on('window-maximize', refetchMaximize);
    props.ipc.on('window-unmaximize', refetchMaximize);
  });
  onCleanup(() => {
    window.removeEventListener('mousemove', listener);
    window.ipcRenderer.removeAllListeners('classic:pin-state');
  });
  return (
    <nav
      class={titleStyle()}
      data-macos={props.isMacOS}
      data-show={mouseY() < 32}
      data-ytmd-main-panel={true}
      id={'ytmd-title-bar-main-panel'}
    >
      <div
        style={{ display: 'flex', gap: '4px', '-webkit-app-region': 'no-drag' }}
      >
        {(
          [
            [
              'settings',
              'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',
              'Settings',
            ],
            [
              'visualizer',
              'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h2l2-4 2 8 2-4',
              'Fullscreen visualizer',
            ],
            [
              'game',
              'M7 7h10l4 10-3 2-4-4h-4l-4 4-3-2Z M7 10v4m-2-2h4m7-1h.01m2 2h.01',
              'Prism Run',
            ],
            ['pin', 'M8 3h8l-1 7 4 4H5l4-4Z M12 14v7', 'Always on top'],
            ['back', 'M19 12H5m6-6-6 6 6 6', 'Back'],
            ['forward', 'M5 12h14m-6-6 6 6-6 6', 'Forward'],
            ['home', 'm3 10 9-7 9 7M6 9v12h12V9M10 21v-7h4v7', 'Home'],
            [
              'library',
              'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z',
              'Library',
            ],
          ] as const
        ).map(([action, icon, label]) => (
          <button
            title={label}
            aria-label={label}
            aria-pressed={action === 'pin' ? pinned() : undefined}
            onClick={async () => {
              const value = await window.ipcRenderer.invoke(
                'classic:navigate',
                action,
              );
              if (action === 'pin') setPinned(!!value);
            }}
            style={{
              background: 'transparent',
              color: 'inherit',
              border: 'none',
              cursor: 'pointer',
              'font-size': '18px',
              padding: '6px',
              width: '34px',
              height: '32px',
              display: 'grid',
              'place-items': 'center',
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path
                fill={action === 'library' ? 'currentColor' : 'none'}
                d={
                  action === 'pin'
                    ? pinned()
                      ? 'M8 3h8l-1 7 4 4H5l4-4Z M12 14v7'
                      : 'm5 3 16 16M8 3h8l-1 7m-6 0-4 4h9M12 14v7'
                    : icon
                }
              />
            </svg>
          </button>
        ))}
      </div>
      <Show when={props.enableController}>
        <div style={{ flex: 1 }} />
        <WindowController
          isMaximize={isMaximized()}
          onClose={handleClose}
          onMinimize={handleMinimize}
          onToggleMaximize={handleToggleMaximize}
        />
      </Show>
    </nav>
  );
};
