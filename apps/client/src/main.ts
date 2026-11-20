import Phaser from 'phaser';
import { PlayScene } from './scenes/PlayScene';
import { ShopScene } from './scenes/ShopScene';
import { OnlineScene } from './scenes/OnlineScene';
import { noteSession } from './services/storage';
import { initAnalytics } from './services/analytics';
import { sfx } from './audio/sfx';
import { getProgress } from './services/storage';
import { registerSW } from 'virtual:pwa-register';
import { GAME_H, GAME_W } from './layout';

noteSession();
sfx.setMuted(getProgress().muted === true);
initAnalytics();
registerSW({ immediate: true });

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#111418',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: { activePointers: 1 },
  render: { antialias: true, roundPixels: false },
  scene: [PlayScene, ShopScene, OnlineScene],
});
