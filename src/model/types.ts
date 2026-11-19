/** Core domain types. Everything here is plain data so it can be saved as JSON. */

export type Side = 'L' | 'R' | 'C';

export interface Position {
  code: string;
  name: string;
  /** e.g. GK, DEF, ATT. Free-form so other formations can be added. */
  role: string;
  side: Side;
}

export interface Player {
  id: string;
  name: string;
  /** Free-form colour tag defined by the coaches, e.g. "blue". */
  group: string;
  available: boolean;
  /** Position codes this player may play. */
  allowed_positions: string[];
  /** Only ever plays in goal. Overrides allowed_positions. */
  gk_only?: boolean;
  /** Preferred side of the pitch, used by the "Preferred side" rule. */
  side?: 'L' | 'R';
}

export interface MatchSettings {
  quarters: number;
  quarter_length_min: number;
  slot_length_min: number;
  /** Minutes (slot boundaries) at which substitutions are allowed. */
  sub_points: number[];
  /** Minutes at which the goalkeeper may change. */
  gk_change_points: number[];
}

/** Everything about the match except the rules: match, positions, squad. */
export interface Settings {
  match: MatchSettings;
  positions: Position[];
  squad: Player[];
}

/** One map per slot: position code -> player id (null = empty). */
export type Rota = Array<Record<string, string | null>>;

export type Weight = 'low' | 'medium' | 'high';
export type Mode = 'hard' | 'soft';

interface Base {
  id: string;
  enabled: boolean;
  mode: Mode;
  weight: Weight;
}

export interface EvenTime extends Base {
  kind: 'even_time';
  maxDiff: number;
}
export interface MinutesRange extends Base {
  kind: 'minutes';
  min: number | null;
  max: number | null;
  /** Empty = all available players. */
  players: string[];
}
export interface RoleBalance extends Base {
  kind: 'role_balance';
  minDef: number;
  minAtt: number;
  /** Empty = every available outfield player. */
  players: string[];
}
export interface GkShare extends Base {
  kind: 'gk_share';
  /**
   * Legacy: who may go in goal. Now always empty: the GK ticks on the squad
   * decide that (old setups are converted by migrateSetup).
   */
  players: string[];
  minEach: number | null;
  evenWithin: number | null;
}
export interface RoleBlocks extends Base {
  kind: 'role_blocks';
  /** Extra minutes, inside quarters, where a player may switch role. */
  exceptions: number[];
}
export interface PositionStability extends Base {
  kind: 'position_stability';
  /** Max position changes per player while staying on the pitch. */
  maxChanges: number;
}
export interface MaxBench extends Base {
  kind: 'max_bench';
  maxMinutes: number;
}
export interface StartFinish extends Base {
  kind: 'start_finish';
}
export interface Together extends Base {
  kind: 'together';
  a: string;
  b: string;
  scope: 'pitch' | 'side' | 'unit';
}
export interface Apart extends Base {
  kind: 'apart';
  a: string;
  b: string;
  scope: 'pitch' | 'unit';
}
export interface GroupMix extends Base {
  kind: 'group_mix';
  group: string;
  min: number | null;
  max: number | null;
}
export interface Pin extends Base {
  kind: 'pin';
  player: string;
  /** A position code, 'BENCH' or 'ON' (any position). */
  position: string;
  from: number;
  to: number;
}
export interface GkPlan extends Base {
  kind: 'gk_plan';
  /** Goalkeeper block start minute -> player id ('' = solver picks). */
  keepers: Record<string, string>;
}
export interface Spells extends Base {
  kind: 'spells';
  /** Number of separate spells on the pitch (times coming on). */
  min: number | null;
  max: number | null;
  /** Empty = all available players. */
  players: string[];
}
export interface MaxOn extends Base {
  kind: 'max_on';
  /** Longest continuous time on the pitch, in minutes. */
  maxMinutes: number;
  /** Empty = all available players. */
  players: string[];
}

export interface Rotate extends Base {
  kind: 'rotate';
  /** Empty = all available players. */
  players: string[];
}
export interface SidePref extends Base {
  kind: 'side_pref';
  /** Legacy: sides now live on each player (Player.side); converted by migrateSetup. */
  sides?: Record<string, 'L' | 'R'>;
}

export type Constraint =
  | EvenTime
  | MinutesRange
  | RoleBalance
  | GkShare
  | RoleBlocks
  | PositionStability
  | MaxBench
  | StartFinish
  | Together
  | Apart
  | GroupMix
  | Pin
  | GkPlan
  | Spells
  | MaxOn
  | Rotate
  | SidePref;

export type ConstraintKind = Constraint['kind'];

export interface Break {
  /** Constraint id, or 'builtin:<rule>'. */
  rule: string;
  severity: Mode;
  message: string;
  /** Size of the break in penalty units (used to score soft breaks). */
  amount: number;
  weight?: Weight;
  players?: string[];
  slots?: number[];
}
