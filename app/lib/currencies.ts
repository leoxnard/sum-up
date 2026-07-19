// ECB reference-rate currencies (what frankfurter.dev serves).
export const CURRENCIES = [
  "EUR", "USD", "GBP", "CHF", "JPY", "AUD", "BGN", "BRL", "CAD", "CNY",
  "CZK", "DKK", "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "KRW", "MXN",
  "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY",
  "ZAR",
] as const;

export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}
