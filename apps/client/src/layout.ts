/** 논리 해상도 (세로 고정, FIT 스케일) */
export const GAME_W = 360;
export const GAME_H = 640;

/** 1 m = 40 px */
export const PPM = 40;
/** 플레이어의 화면 y */
export const PLAYER_Y = 470;
export const TRACK_LEFT = 60;
export const TRACK_RIGHT = 300;
export const TRACK_CX = (TRACK_LEFT + TRACK_RIGHT) / 2;

export const COLORS = {
  bg: 0x111418,
  track: 0x1c222a,
  line: 0x2d3640,
  player: 0x4fd1c5,
  bot: 0x8a94a3,
  botOut: 0x4a4f57,
  chant: 0x38a169,
  turn: 0xecc94b,
  watch: 0xe53e3e,
  text: '#e8edf3',
  dim: '#8a94a3',
  perfect: '#f6e05e',
  great: '#68d391',
  good: '#63b3ed',
  bad: '#fc8181',
} as const;
