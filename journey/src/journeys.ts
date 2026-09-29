/**
 * The journey definitions this Worker serves. Adding a journey: drop a JSON
 * file in journey/definitions/ and list it here. Every definition is linted
 * when the Worker loads, so a broken one fails the deploy, not an agent.
 */
import { lintDefinition } from "./engine/definitions";
import type { JourneyDefinition } from "./engine/types";

import leadQualification from "../definitions/lead-qualification.json";
import demoExpiring from "../definitions/demo-expiring.json";

const ALL = [leadQualification, demoExpiring] as unknown as JourneyDefinition[];

export const DEFINITIONS: ReadonlyMap<string, JourneyDefinition> = new Map(
  ALL.map((d) => {
    const def = lintDefinition(d);
    return [def.id, def] as const;
  }),
);
