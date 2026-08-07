import { describe, expect, it } from "vitest";

import { matchMember, parseExtraction, type ExtractMember } from "./extract";

const members: ExtractMember[] = [
  { id: "m1", name: "Anna" },
  { id: "m2", name: "Ben Meier" },
  { id: "m3", name: "Jörg-Peter" },
];

const options = { baseCurrency: "EUR", today: "2026-08-07", members };

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe("parseExtraction", () => {
  it("returns null for anything that isn't an expense list", () => {
    expect(parseExtraction("not json", options)).toBeNull();
    expect(parseExtraction(json({ expenses: "nope" }), options)).toBeNull();
    expect(parseExtraction(json({ transcript: "hi" }), options)).toBeNull();
  });

  it("treats an empty list as a valid verdict", () => {
    const result = parseExtraction(json({ expenses: [], transcript: "hallo" }), options);
    expect(result).toEqual({ expenses: [], transcript: "hallo" });
  });

  it("keeps a usable row and drops rows without a positive amount", () => {
    const result = parseExtraction(
      json({
        expenses: [
          { title: "Supermarkt", amount: "24,50", currency: "eur", date: "2026-08-05" },
          { title: "Kaputt", amount: "abc", currency: "EUR" },
          { title: "Gutschrift", amount: "-8.00", currency: "EUR" },
        ],
      }),
      options,
    );
    expect(result?.expenses).toHaveLength(1);
    expect(result?.expenses[0]).toMatchObject({
      title: "Supermarkt",
      amountCents: 2450,
      currency: "EUR",
      date: "2026-08-05",
    });
  });

  it("falls back to the base currency and rejects unusable dates", () => {
    const result = parseExtraction(
      json({
        expenses: [
          { title: "Taxi", amount: "12", currency: "gold", date: "2026-12-24" },
          { title: "Kino", amount: "9", currency: "CHF", date: "gestern" },
        ],
      }),
      { ...options, baseCurrency: "CHF" },
    );
    expect(result?.expenses[0]).toMatchObject({ currency: "CHF", date: null });
    expect(result?.expenses[1]).toMatchObject({ currency: "CHF", date: null });
  });

  it("only keeps a category the app actually knows", () => {
    const result = parseExtraction(
      json({
        expenses: [
          { title: "Pizza", amount: "10", currency: "EUR", category: "Food" },
          { title: "Raumschiff", amount: "10", currency: "EUR", category: "spaceship" },
        ],
      }),
      options,
    );
    expect(result?.expenses[0].category).toBe("food");
    expect(result?.expenses[1].category).toBeNull();
  });

  it("resolves spoken people to member ids", () => {
    const result = parseExtraction(
      json({
        expenses: [
          {
            title: "Essen",
            amount: "40",
            currency: "EUR",
            payer: "ben",
            participants: ["Anna", "Ben Meier"],
          },
        ],
        transcript: "Ben hat 40 Euro fürs Essen bezahlt.",
      }),
      options,
    );
    expect(result?.expenses[0].payerId).toBe("m2");
    expect(result?.expenses[0].participantIds).toEqual(["m1", "m2"]);
    expect(result?.transcript).toBe("Ben hat 40 Euro fürs Essen bezahlt.");
  });

  it("expands 'everyone' and ignores a half-understood participant list", () => {
    const parsed = parseExtraction(
      json({
        expenses: [
          { title: "A", amount: "1", currency: "EUR", participants: ["alle"] },
          { title: "B", amount: "1", currency: "EUR", participants: ["Anna", "Sandra"] },
          { title: "C", amount: "1", currency: "EUR" },
        ],
      }),
      options,
    );
    expect(parsed?.expenses[0].participantIds).toEqual(["m1", "m2", "m3"]);
    expect(parsed?.expenses[1].participantIds).toBeNull();
    expect(parsed?.expenses[2].participantIds).toBeNull();
  });

  it("keeps a spoken note but never invents one", () => {
    const result = parseExtraction(
      json({
        expenses: [
          { title: "Hotel", amount: "120", currency: "EUR", note: "  Anzahlung  " },
          { title: "Bahn", amount: "30", currency: "EUR" },
        ],
      }),
      options,
    );
    expect(result?.expenses[0].note).toBe("Anzahlung");
    expect(result?.expenses[1].note).toBeNull();
  });
});

describe("matchMember", () => {
  it("matches case, accents and first names", () => {
    expect(matchMember("ANNA", members)).toBe("m1");
    expect(matchMember("jorg peter", members)).toBe("m3");
    expect(matchMember("Ben", members)).toBe("m2");
  });

  it("refuses to guess", () => {
    expect(matchMember("Sandra", members)).toBeNull();
    expect(matchMember("", members)).toBeNull();
    expect(matchMember("Anna", [])).toBeNull();
    // Two members answering to the same name is the user's call, not ours.
    const twins: ExtractMember[] = [
      { id: "a", name: "Chris" },
      { id: "b", name: "Chris" },
    ];
    expect(matchMember("Chris", twins)).toBeNull();
  });
});
