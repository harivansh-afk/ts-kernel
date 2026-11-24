{
  lib,
  stdenvNoCC,
  bun,
  makeWrapper,
}:
let
  modules = stdenvNoCC.mkDerivation {
    name = "ts-kernel-node-modules";
    src = lib.fileset.toSource {
      root = ./.;
      fileset = lib.fileset.unions [
        ./package.json
        ./bun.lock
      ];
    };
    nativeBuildInputs = [ bun ];
    dontConfigure = true;
    dontFixup = true;
    buildPhase = ''
      export HOME="$TMPDIR"
      bun install --frozen-lockfile --no-progress --ignore-scripts
    '';
    installPhase = "mkdir $out && cp -R node_modules $out/node_modules";
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash =
      {
        aarch64-linux = "sha256-R5FtdYUrtELHFX1iyqobP3Rr4glx3fimINPN7RIQkoQ=";
      }
      .${stdenvNoCC.hostPlatform.system}
        or (throw "ts-kernel: no node_modules hash for ${stdenvNoCC.hostPlatform.system} yet");
  };
in
stdenvNoCC.mkDerivation {
  pname = "ts-kernel";
  version = "0.1.0";
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [
      ./package.json
      ./src
    ];
  };
  nativeBuildInputs = [ makeWrapper ];
  dontConfigure = true;
  dontBuild = true;
  installPhase = ''
    mkdir -p $out/lib/ts-kernel $out/bin
    cp -R package.json src $out/lib/ts-kernel/
    ln -s ${modules}/node_modules $out/lib/ts-kernel/node_modules
    makeWrapper ${bun}/bin/bun $out/bin/ts-kernel --add-flags "$out/lib/ts-kernel/src/main.ts"
  '';
  passthru = { inherit modules; };
  meta.mainProgram = "ts-kernel";
}
