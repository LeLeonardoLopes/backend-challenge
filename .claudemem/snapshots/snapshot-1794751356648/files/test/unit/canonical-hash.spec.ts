import { describe, expect, it } from "bun:test";
import { computeCanonicalPayloadHash } from "../../src/domain/utils/canonical-hash";

describe("Canonical Payload Hash", () => {
  it("should generate identical hash for objects with different key order", () => {
    const objA = {
      playerId: "player-1",
      amount: "50.00",
      gameId: "roulette",
      roundId: "round-1",
    };

    const objB = {
      roundId: "round-1",
      gameId: "roulette",
      amount: "50.00",
      playerId: "player-1",
    };

    const hashA = computeCanonicalPayloadHash(objA);
    const hashB = computeCanonicalPayloadHash(objB);

    expect(hashA).toBe(hashB);
  });

  it("should generate different hash when values differ", () => {
    const objA = {
      playerId: "player-1",
      amount: "50.00",
      gameId: "roulette",
    };

    const objB = {
      playerId: "player-1",
      amount: "500.00", // changed amount
      gameId: "roulette",
    };

    const hashA = computeCanonicalPayloadHash(objA);
    const hashB = computeCanonicalPayloadHash(objB);

    expect(hashA).not.toBe(hashB);
  });
});
