import { correctEDC15PChecksum } from "@/lib/ecu/bosch/checksums/edc15p-checksum";
export type MultimapSelector = "cruise" | "brake" | "brakeCruise";
// This fingerprint covers the complete inspected program, including the hook,
// selector RAM references and unused code cave. Calibration banks and the
// program checksum storage are excluded. A part number alone is insufficient.
const GN_PROGRAM_HASH = "5a1ee89a5d99ef873c80246a64d13bd8fcea55aa13ccd7885b54d71d07805030";
// FD4102 supplied by the user: main program 0x14000..0x4BFFFB is identical
// to GN4308. Only identification metadata and its checksum differ below it.
const FD_PROGRAM_HASH = "34b4962b9feedada9da0aff55303b96b712b81a691cbbbeb00c4ace26af4a188";
const GQ_PROGRAM_HASH = "2c43ed86794f45530be34ffa43732ebc1c17ce0d6afb7393afaf1ecd5231bae4";
const GK_PROGRAM_HASH = "b8d45ea3aab8ce38b9635bfd20f706ffa15bc9a83720345abe0c0c51822ac9aa";
const SIGNATURE = [0x67, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x56, 0x34, 0x2e, 0x31];
function matches(data: Uint8Array, address: number, bytes: readonly number[]): boolean {
  return bytes.every((value, index) => data[address + index] === value);
}
export async function validateGNFDMultimapInput(input: Uint8Array): Promise<void> {
  if (input.length !== 0x80000) throw new Error("This conversion requires a complete 512 KiB ECU file.");
  const identity = (address: number) => String.fromCharCode(...input.slice(address, address + 11));
  const programHash = await binaryHash(input.slice(0, 0x4bffc));
  const isGK = programHash === GK_PROGRAM_HASH;
  const identityOK = isGK
    ? [0x538d4, 0x738d4].every(address => identity(address) === "038906012GK")
    : [0x53e67, 0x73e67].every(address => /^038906012(GN|FD|GQ)$/.test(identity(address)));
  if (!identityOK) throw new Error("Multi-Map Beta supports only inspected FD, GN, GQ and GK firmware profiles.");
  if (![GN_PROGRAM_HASH, FD_PROGRAM_HASH, GQ_PROGRAM_HASH, GK_PROGRAM_HASH].includes(programHash))
    throw new Error("This program differs from the inspected beta firmware. It needs a separate compatibility profile.");
  if (programHash === FD_PROGRAM_HASH && ![0x53e67, 0x63e67, 0x73e67].every(address => identity(address) === "038906012FD"))
    throw new Error("The FD firmware bank identities are not supported.");
  if (!matches(input, 0x50001, SIGNATURE) || !matches(input, 0x70001, SIGNATURE) ||
      !matches(input, 0x51bf0, [isGK ? 12 : 2, 0]) || !matches(input, 0x71bf0, [isGK ? 11 : 1, 0]))
    throw new Error("The original bank layout is not supported.");
  const middleEmpty = input.slice(0x5c000, 0x6c000).every(value => value === 0xc3);
  const stockFDMiddle = programHash === FD_PROGRAM_HASH &&
    matches(input, 0x60001, SIGNATURE) && matches(input, 0x61bf0, [4, 0]);
  if (!middleEmpty && !stockFDMiddle)
    throw new Error("The middle bank is in use and does not match the supported original FD layout.");
}
export async function binaryHash(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(data).buffer);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
export type MultimapVehicleConfiguration = "manual" | "automatic" | "4x4";
export type MultimapSourceBank = 1 | 2 | 3;
export type MultimapBankInfo = { bank: MultimapSourceBank; start: number; end: number; marker: "SG" | "AG"; bankID: number };

// Save the entire generated result against the version's raw imported/original
// base. Old cell/axis edits must be cleared after staging this byte delta.
export function buildMultimapVersionChanges(base: Uint8Array, result: Uint8Array): Map<number, { oldValue: number; newValue: number }> {
  if (base.length !== result.length) throw new Error("The version base and generated file sizes differ.");
  const changes = new Map<number, { oldValue: number; newValue: number }>();
  for (let address = 0; address < result.length; address++) {
    if (base[address] !== result[address]) changes.set(address, { oldValue: base[address], newValue: result[address] });
  }
  return changes;
}

export function getMultimapSourceBanks(input: Uint8Array): MultimapBankInfo[] {
  if (input.length !== 0x80000) return [];
  const banks: MultimapBankInfo[] = [];
  for (const bank of [1, 2, 3] as const) {
    const start = 0x4c000 + (bank - 1) * 0x10000;
    const component = String.fromCharCode(...input.slice(start + 0x78d4, start + 0x78d4 + 100));
    const marker = /\b(SG|AG)\b/.exec(component)?.[1] as "SG" | "AG" | undefined;
    const expectedIDs = bank === 1 ? [2, 12] : bank === 2 ? [3, 4] : [1, 11];
    if (/^038906012(?:GN|FD|GQ|GK) /.test(component) && marker &&
        matches(input, start + 0x4001, SIGNATURE) && expectedIDs.includes(input[start + 0x5bf0]) && input[start + 0x5bf1] === 0)
      banks.push({ bank, start, end: start + 0x10000, marker, bankID: input[start + 0x5bf0] });
  }
  return banks;
}

export async function applyGN4308Multimap(input: Uint8Array, selector: MultimapSelector, initializeAllBanks: boolean, configuration: MultimapVehicleConfiguration, source: MultimapSourceBank): Promise<Uint8Array> {
  if (!["manual", "automatic", "4x4"].includes(configuration)) throw new Error("Choose the vehicle configuration.");
  if (configuration === "4x4") throw new Error("No verified 4×4 source bank is available for these firmware profiles.");
  if (!getMultimapSourceBanks(input).some(bank => bank.bank === source))
    throw new Error("The chosen source code block is absent or has an unsupported bank structure.");
  if ((configuration === "automatic" || source !== 1) && !initializeAllBanks)
    throw new Error("This source/configuration requires copying the selected bank to all three banks.");
  if (configuration === "automatic" && selector !== "brakeCruise")
    throw new Error("Automatic configuration requires the experimental brake + cruise SET selector.");
  if (selector !== "cruise" && selector !== "brake" && selector !== "brakeCruise") throw new Error("Choose a selector method.");
  if (initializeAllBanks && matches(input, 0x14764, [0xda, 0x09, 0x00, 0xa0])) {
    // Accept only this tool's exact selector code and known three-bank layout.
    const expected = [...ROUTINE];
    if (input[0x1a006] === 0x66 && input[0x1a00e] === 0x69) expected[6] = 0x66;
    else if (input[0x1a006] === 0x63 && input[0x1a00e] === 0x66) expected[14] = 0x66;
    if (!matches(input, 0x1a000, expected) || !matches(input, 0x60001, SIGNATURE) || !matches(input, 0x61bf0, [3, 0]))
      throw new Error("This existing multimap is not a recognized beta conversion.");
    const originalProgram = new Uint8Array(input);
    originalProgram.set([0x08, 0x04, 0xf0, 0x94], 0x14764);
    originalProgram.fill(0xc3, 0x1a000, 0x1a000 + ROUTINE.length);
    originalProgram.fill(0xc3, 0x5c000, 0x6c000);
    // FD validation also checks its middle-bank identity; retain it for this check.
    if (await binaryHash(originalProgram.slice(0, 0x4bffc)) === FD_PROGRAM_HASH) {
      originalProgram.set(input.slice(0x53e67, 0x53e72), 0x63e67);
      originalProgram.set(SIGNATURE, 0x60001);
      originalProgram.set([4, 0], 0x61bf0);
    }
    await validateGNFDMultimapInput(originalProgram);
  } else await validateGNFDMultimapInput(input);
  const fingerprintInput = new Uint8Array(input);
  fingerprintInput.set([0x08, 0x04, 0xf0, 0x94], 0x14764);
  fingerprintInput.fill(0xc3, 0x1a000, 0x1a000 + ROUTINE.length);
  const isGK = await binaryHash(fingerprintInput.slice(0, 0x4bffc)) === GK_PROGRAM_HASH;
  const output = new Uint8Array(input);
  const sourceStart = 0x4c000 + (source - 1) * 0x10000;
  // Snapshot before replacing any bank. Copy layout, axes, calibration and
  // configuration from the selected original bank, retaining selector IDs.
  const sourceBank = input.slice(sourceStart, sourceStart + 0x10000);
  output.set(sourceBank, 0x5c000);
  output[0x61bf0] = 3;
  if (initializeAllBanks) {
    // Copy the complete layout, axes, maps and configuration, not just cells.
    // Keep the final bank's original identifier at its original location.
    output.set(sourceBank, 0x4c000);
    output.set(input.slice(0x51bf0, 0x51bf2), 0x51bf0);
    output.set(sourceBank, 0x6c000);
    output.set(input.slice(0x71bf0, 0x71bf2), 0x71bf0);
  }
  output.set([0xda, 0x09, 0x00, 0xa0], 0x14764);
  output.set(ROUTINE, 0x1a000);
  if (selector === "brake") output[0x1a00e] = 0x66;
  // Replace the clutch input with brake; retain the cruise SET input.
  // All original branches and the selector latch remain unchanged.
  if (selector === "brakeCruise") output[0x1a006] = 0x66;
  // With an identical program, these selector-specific program checksum words
  // preserve the checksum seed used by the original calibration blocks.
  output.set((isGK ? GK_PROGRAM_CHECKSUMS : PROGRAM_CHECKSUMS)[selector], 0x4bffc);
  const corrected = correctEDC15PChecksum(Array.from(output));
  if (corrected.info.variant !== "tdi41_2002" || corrected.info.found !== 11)
    throw new Error("The multimap checksum layout is not supported.");
  const result = new Uint8Array(corrected.correctedData);
  const check = correctEDC15PChecksum(Array.from(result)).info;
  if (check.result !== "OK" || check.found !== 11 || check.fixed !== 0 || check.matched !== 11)
    throw new Error("Multimap checksum verification failed; no changes were applied.");
  // Checksum correction may update storage words, but may never alter tuning.
  const checksumOffsets = new Set([0xfffc, 0x13ffc, 0x4fffc, 0x50b7c,
    0x5bffc, 0x5fffc, 0x60b7c, 0x6bffc, 0x6fffc, 0x70b7c, 0x7bffc]);
  for (let address = 0; address < result.length; address++) {
    const checksumWord = address & ~3;
    if (result[address] !== output[address] && !checksumOffsets.has(checksumWord))
      throw new Error("Checksum correction changed an unexpected byte; no changes were applied.");
  }
  return result;
}
const ROUTINE = [243, 242, 206, 229, 243, 244, 99, 195, 154, 242, 38, 0, 243, 244, 105, 195, 154, 242, 2, 0, 47, 241, 13, 33, 154, 241, 31, 32, 46, 241, 231, 244, 40, 0, 247, 244, 207, 229, 70, 0, 60, 0, 45, 9, 70, 0, 52, 0, 45, 12, 209, 48, 230, 0, 60, 0, 230, 1, 61, 0, 13, 12, 209, 48, 230, 0, 52, 0, 230, 1, 53, 0, 13, 6, 209, 48, 230, 0, 56, 0, 230, 1, 57, 0, 13, 0, 13, 1, 46, 241, 243, 244, 207, 229, 45, 18, 41, 65, 247, 244, 207, 229, 70, 0, 52, 0, 45, 6, 70, 0, 56, 0, 45, 6, 230, 244, 64, 31, 13, 6, 230, 244, 160, 15, 13, 3, 230, 244, 224, 46, 13, 0, 247, 242, 206, 229, 8, 4, 240, 148, 219, 0];
const PROGRAM_CHECKSUMS = { cruise: [251, 156, 14, 126], brake: [134, 18, 206, 119], brakeCruise: [149, 153, 84, 82] };


// Separate compensation preserves the inspected GK KD34 program checksum seed.
const GK_PROGRAM_CHECKSUMS = { cruise: [200, 114, 69, 184], brake: [130, 196, 123, 174], brakeCruise: [35, 66, 116, 76] };
