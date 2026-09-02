// Give the mac artifacts the name a person would use, not the one a compiler would.
//
// electron-builder's `artifactName` can interpolate ${arch}, but ${arch} is only ever
// "arm64" or "x64" — there is no hook for mapping it to words. So the config asks for the
// arch token and this renames it afterwards, which keeps one naming scheme for both
// `npm run package` and CI rather than passing -c overrides on the command line.
//
// Dashes throughout, not spaces: GitHub rewrites a space in a release asset name to a
// full stop, so "Keito Timer 0.1.0 Apple Silicon.dmg" would reach the release page as
// "Keito.Timer.0.1.0.Apple.Silicon.dmg". Dashes survive intact. That is also why
// artifactName spells "Keito-Timer" out rather than interpolating ${productName}, which
// carries a space.
const { rename } = require("node:fs/promises")
const path = require("node:path")

// Anchored to the leading dash so "-x64" cannot match inside a version number.
const ARCH_NAMES = [
  ["-arm64", "-Apple-Silicon"],
  ["-x64", "-Intel-Mac"],
]

exports.default = async function afterAllArtifactBuild(result) {
  const renamed = []

  for (const artifactPath of result.artifactPaths) {
    const dir = path.dirname(artifactPath)
    const base = path.basename(artifactPath)

    const friendly = ARCH_NAMES.reduce(
      (name, [token, replacement]) => name.replace(token, replacement),
      base,
    )

    if (friendly === base) {
      renamed.push(artifactPath)
      continue
    }

    const target = path.join(dir, friendly)
    await rename(artifactPath, target)
    console.log(`  • renamed ${base} -> ${friendly}`)
    renamed.push(target)
  }

  // electron-builder takes this as the artifact list, so a publisher would see the new
  // names too. Nothing publishes from here — the workflow uploads by glob — but returning
  // the old paths would be a lie waiting to bite whoever turns publishing on.
  return renamed
}
