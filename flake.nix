{
  description = "One MCP tool, ts: a TypeScript session whose globals are your MCP servers' tools, typed";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "aarch64-linux"
        "aarch64-darwin"
      ];
      each = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = each (pkgs: rec {
        ts-kernel = pkgs.callPackage ./package.nix { };
        default = ts-kernel;
      });
    };
}
