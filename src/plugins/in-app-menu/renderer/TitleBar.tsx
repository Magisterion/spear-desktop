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
    window.addEventListener('mousemove', listener);
    props.ipc.on('window-maximize', refetchMaximize);
    props.ipc.on('window-unmaximize', refetchMaximize);
  });
  onCleanup(() => window.removeEventListener('mousemove', listener));
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
            ['back', '←', 'Back'],
            ['forward', '→', 'Forward'],
            ['home', '⌂', 'Home'],
            ['library', '♫', 'Library'],
            ['settings', '⚙', 'Settings'],
          ] as const
        ).map(([action, icon, label]) => (
          <button
            title={label}
            aria-label={label}
            onClick={() =>
              window.ipcRenderer.invoke('classic:navigate', action)
            }
            style={{
              background: 'transparent',
              color: 'inherit',
              border: 'none',
              cursor: 'pointer',
              'font-size': '18px',
              padding: '0 8px',
            }}
          >
            {icon}
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
