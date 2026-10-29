import {describe, expect, it} from "vitest";
import {isReleased, pinsForDisplay} from "./mapUtils";
describe("checkpoint presentation",()=>it("sorts a copy for usability without changing the original or semantic order",()=>{const pins=[{id:1,name:"Zulu",latitude:0,longitude:0},{id:2,name:"Alpha",latitude:1,longitude:1}];expect(pinsForDisplay(pins).map(p=>p.name)).toEqual(["Alpha","Zulu"]);expect(pins.map(p=>p.name)).toEqual(["Zulu","Alpha"])}));

describe("checkpoint release", () => it("is released exactly at the release instant, not a millisecond before", () => {
  const at = Date.parse("2030-01-01T09:50:00Z");
  expect(isReleased("2030-01-01T09:50:00Z", at - 1)).toBe(false);
  expect(isReleased("2030-01-01T09:50:00Z", at)).toBe(true);
  expect(isReleased("2030-01-01T09:50:00", at)).toBe(true); // zone-less API value is UTC
}));
