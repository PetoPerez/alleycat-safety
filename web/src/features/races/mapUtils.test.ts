import {describe, expect, it} from "vitest";
import {pinsForDisplay} from "./mapUtils";
describe("checkpoint presentation",()=>it("sorts a copy for usability without changing the original or semantic order",()=>{const pins=[{id:1,name:"Zulu",latitude:0,longitude:0},{id:2,name:"Alpha",latitude:1,longitude:1}];expect(pinsForDisplay(pins).map(p=>p.name)).toEqual(["Alpha","Zulu"]);expect(pins.map(p=>p.name)).toEqual(["Zulu","Alpha"])}));
