import { Sprite } from 'pixi.js';

export interface NodeSpriteData {
  terrain: Sprite;
  object?: Sprite;
  claimIndicator?: Sprite;
}

export interface NodeSprites {
  [nodeKey: string]: NodeSpriteData;
}
