// Konza addresses (world.md section 3, AD-01): zone, block, plot, unit, and a check code.

import { swNumber } from "../sw.ts";

export type AddressRow = {
  zone: number;
  block: string;
  plot: number;
  unit: number;
  check_code: string;
};

const NUMBERS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** English words for 0 to 999, as read aloud. */
export function words(n: number): string {
  if (n < 20) return NUMBERS[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${NUMBERS[n % 10]}` : "");
  return `${NUMBERS[Math.floor(n / 100)]} hundred` + (n % 100 ? ` and ${words(n % 100)}` : "");
}

export function formatAddress(a: AddressRow) {
  return {
    zone: a.zone,
    block: a.block,
    plot: a.plot,
    unit: a.unit,
    written: `Z${a.zone} ${a.block} P${String(a.plot).padStart(3, "0")} U${
      String(a.unit).padStart(2, "0")
    }`,
    spoken: `zone ${words(a.zone)}, block ${a.block[0]} ${words(Number(a.block.slice(1)))}, plot ${
      words(a.plot)
    }, unit ${words(a.unit)}`,
    // K5 (MED-301): draft Swahili terms (eneo, bloku, kiwanja, nyumba namba), for Mahs to review.
    spoken_sw: `eneo la ${swNumber(a.zone)}, bloku ${a.block[0]} ${
      swNumber(Number(a.block.slice(1)))
    }, kiwanja ${swNumber(a.plot)}, nyumba namba ${swNumber(a.unit)}`,
    check_code: a.check_code,
  };
}
