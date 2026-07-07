export type { IHomeworkStore } from './homework.js';
export type { ISettlementStore } from './settlement.js';
export type { IShopStore } from './shop.js';
export type { IAuthStore } from './auth.js';
export type { IOpsStore } from './ops.js';
export type { ISyncStore } from './sync.js';

import type { IHomeworkStore } from './homework.js';
import type { ISettlementStore } from './settlement.js';
import type { IShopStore } from './shop.js';
import type { IAuthStore } from './auth.js';
import type { IOpsStore } from './ops.js';
import type { ISyncStore } from './sync.js';

export interface IDatabase extends IHomeworkStore, ISettlementStore, IShopStore, IAuthStore, IOpsStore, ISyncStore {}
