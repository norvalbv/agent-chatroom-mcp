export type Ymd = { y: number; m: number; d: number };
export type Customer = { id: string; region: string; taxExempt: boolean };
export type Coupon = { code: string; kind: 'percent' | 'fixed'; value: number; maxCents?: number };
export type Sub = { id: string; planId: string; cycle: 'monthly' | 'annual'; cents: number; start: Ymd; end?: Ymd };
