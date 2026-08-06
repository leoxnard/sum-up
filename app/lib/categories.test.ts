import { describe, expect, it } from "vitest";
import { categorizeByKeywords, normalizeTitle } from "./categories";

describe("normalizeTitle", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeTitle("  REWE   Einkauf ")).toBe("rewe einkauf");
  });
});

describe("categorizeByKeywords", () => {
  it.each([
    ["Pizzeria Luigi", "food"],
    ["Restaurant am See", "food"],
    ["REWE Einkauf", "groceries"],
    ["Taxi Flughafen", "transport"],
    ["Hotel Adlon", "accommodation"],
    ["Museum Ticket", "transport"], // "ticket*" wins: transport precedes activities
    ["Kino", "activities"],
    ["Amazon Bestellung", "shopping"],
    ["Bier im Biergarten", "food"],
    ["U-Bahn Ticket", "transport"],
    ["Media Markt", "shopping"],
    ["H&M", "shopping"],
  ])("categorizes %j as %s", (title, expected) => {
    expect(categorizeByKeywords(title)).toBe(expected);
  });

  // Regression table: every one of these was mis-categorized by the old
  // substring matcher, which hit keywords in the middle of unrelated words.
  it.each([
    ["Stadttour Barcelona", "activities"], // was food via "bar"
    ["Reise nach Rom", null], //             was food via "eis"
    ["Preis für Tickets", "transport"], //   "eis" no longer hits; "tickets" does
    ["Sparkasse Gebühr", null], //           was groceries via "spar"
    ["Rentnerrabatt", null], //              was accommodation via "rent"
    ["Gaspreis", null], //                   was food via "eis"
    ["Barbershop", null], //                 was food via "bar"
    ["Weisswein", null], //                  was food via "eis"
    ["Amsterdam Grachtenfahrt", null], //    "dm" no longer hits mid-word
    ["Bardeckel", null], //                  was food via "bar"
  ])("no longer mis-categorizes %j", (title, expected) => {
    expect(categorizeByKeywords(title)).toBe(expected);
  });

  it("still matches the standalone words those keywords were meant for", () => {
    expect(categorizeByKeywords("Bar Rechnung")).toBe("food");
    expect(categorizeByKeywords("Eis am Strand")).toBe("food");
    expect(categorizeByKeywords("Spar Markt")).toBe("groceries");
    expect(categorizeByKeywords("Rent für die Woche")).toBe("accommodation");
    expect(categorizeByKeywords("dm Drogerie")).toBe("groceries");
  });

  it("returns null on a miss and on empty input", () => {
    expect(categorizeByKeywords("Bettwäsche")).toBeNull();
    expect(categorizeByKeywords("")).toBeNull();
    expect(categorizeByKeywords("   ")).toBeNull();
  });

  it("honours the prefix marker", () => {
    expect(categorizeByKeywords("Pizza")).toBe("food");
    expect(categorizeByKeywords("Pizzeria")).toBe("food");
    expect(categorizeByKeywords("Flugtickets")).toBe("transport");
  });
});
