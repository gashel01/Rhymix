/**
 * Artwork colours.
 *
 * Derived from the id rather than the list position, so a track keeps its
 * colour when the library is re-sorted or something above it is deleted — a
 * thumbnail that changes colour is a thumbnail you stop recognising.
 */

const GRADIENTS = [
  "linear-gradient(140deg,#FF9F0A,#FF375F)",
  "linear-gradient(140deg,#0A84FF,#BF5AF2)",
  "linear-gradient(140deg,#30D158,#0A84FF)",
  "linear-gradient(140deg,#BF5AF2,#FF375F)",
  "linear-gradient(140deg,#64D2FF,#30D158)",
  "linear-gradient(140deg,#FF375F,#BF5AF2)",
];

export const gradientFor = (id) => {
  const text = String(id || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
};
