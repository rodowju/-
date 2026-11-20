import Phaser from 'phaser';
import { PlayScene } from './scenes/PlayScene';
import { ShopScene } from './scenes/ShopScene';
import { noteSession } from './services/storage';
import { GAME_H, GAME_W } from './layout';

noteSession();

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
  scene: [PlayScene, ShopScene],
});
