#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build a tiny Windows MSI applicator for a NewBrain ulit patch stage directory."""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
import uuid
from pathlib import Path


def _gen_uuid() -> str:
    return "{" + str(uuid.uuid4()).upper() + "}"


def _bootstrap_cmd_bytes() -> bytes:
    # APPLICATIONFOLDER / NEWBRAIN_INSTALL_ROOT may be passed by msiexec from the
    # running client's install dir. Otherwise apply.cmd resolves ARP InstallLocation,
    # HKU uninstall keys, and ProfileList %%LOCALAPPDATA%%\.newbrain (SYSTEM-safe).
    # Never hardcode a crawl for NewBrain.exe (find /I / dir /s).
    #
    # CRITICAL: cmd.exe on Chinese Windows mis-parses UTF-8 .cmd files (BOM + CJK).
    # Keep bootstrap.cmd ASCII-only, CRLF, NO BOM. Chinese UI goes through PowerShell.
    # Logging goes to %TEMP%\newbrain-ulit-patch.log for diagnosis.
    # Prefer tar.exe for zip expand (Win10+); fall back to PowerShell Expand-Archive.
    lines = [
        "@echo off",
        "setlocal EnableExtensions EnableDelayedExpansion",
        "title NewBrain ulit patch",
        "set \"HERE=%~dp0\"",
        "if \"%HERE:~-1%\"==\"\\\" set \"HERE=%HERE:~0,-1%\"",
        "set \"STAGE=%HERE%\\_payload\"",
        "set \"ZIP=%HERE%\\payload.ulit.zip\"",
        "set \"LOG=%TEMP%\\newbrain-ulit-patch.log\"",
        "set \"REQUESTED_ROOT=\"",
        "set \"ARG1=%~1\"",
        "REM Plain path in %1 (trailing sentinel .). Avoid ROOT=key; cmd eats NAME=VALUE.",
        "REM Never use %VAR:~-1% while VAR may be empty (cmd exits 255 / flash-quit).",
        "if not \"%ARG1%\"==\"\" set \"REQUESTED_ROOT=%ARG1%\"",
        "if \"%REQUESTED_ROOT%\"==\".\" set \"REQUESTED_ROOT=\"",
        "if \"%REQUESTED_ROOT%\"==\"\" if defined NEWBRAIN_INSTALL_ROOT "
        "set \"REQUESTED_ROOT=%NEWBRAIN_INSTALL_ROOT%\"",
        "if defined REQUESTED_ROOT (",
        "  if \"!REQUESTED_ROOT:~-1!\"==\".\" set \"REQUESTED_ROOT=!REQUESTED_ROOT:~0,-1!\"",
        "  if \"!REQUESTED_ROOT:~-1!\"==\"\\\" set \"REQUESTED_ROOT=!REQUESTED_ROOT:~0,-1!\"",
        ")",
        "echo ===== NewBrain ulit bootstrap %DATE% %TIME% =====> \"%LOG%\"",
        "echo HERE=%HERE%>> \"%LOG%\"",
        "echo ZIP=%ZIP%>> \"%LOG%\"",
        "echo STAGE=%STAGE%>> \"%LOG%\"",
        "echo REQUESTED_ROOT=!REQUESTED_ROOT!>> \"%LOG%\"",
        "echo NEWBRAIN_INSTALL_ROOT=%NEWBRAIN_INSTALL_ROOT%>> \"%LOG%\"",
        "echo USERNAME=%USERNAME%>> \"%LOG%\"",
        "echo USERPROFILE=%USERPROFILE%>> \"%LOG%\"",
        "echo LOCALAPPDATA=%LOCALAPPDATA%>> \"%LOG%\"",
        "set \"FAILUI=%HERE%\\show-ulit-failure.ps1\"",
        "if not exist \"%FAILUI%\" set \"FAILUI=%STAGE%\\show-ulit-failure.ps1\"",
        "if not exist \"%ZIP%\" (",
        "  echo [NewBrain ulit] missing payload.ulit.zip>> \"%LOG%\"",
        "  echo ERROR: missing payload.ulit.zip. See %LOG%",
        "  if exist \"%FAILUI%\" powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File \"%FAILUI%\" "
        "-ExitCode 1 -LogPath \"%LOG%\"",
        "  exit /B 1",
        ")",
        "echo [NewBrain ulit] expanding payload...>> \"%LOG%\"",
        "echo [NewBrain ulit] expanding patch payload...",
        "if exist \"%STAGE%\" rmdir /S /Q \"%STAGE%\"",
        "mkdir \"%STAGE%\" >NUL 2>&1",
        "set \"EXPAND_OK=0\"",
        "where tar.exe >NUL 2>&1",
        "if not errorlevel 1 (",
        "  tar.exe -xf \"%ZIP%\" -C \"%STAGE%\" >> \"%LOG%\" 2>&1",
        "  if not errorlevel 1 set \"EXPAND_OK=1\"",
        ")",
        "if \"%EXPAND_OK%\"==\"0\" (",
        "  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "
        "\"Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%STAGE%' -Force\" "
        ">> \"%LOG%\" 2>&1",
        "  if not errorlevel 1 set \"EXPAND_OK=1\"",
        ")",
        "if not \"%EXPAND_OK%\"==\"1\" (",
        "  echo [NewBrain ulit] expand failed>> \"%LOG%\"",
        "  echo ERROR: failed to expand ulit payload. See %LOG%",
        "  if exist \"%FAILUI%\" powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File \"%FAILUI%\" "
        "-ExitCode 1 -LogPath \"%LOG%\"",
        "  exit /B 1",
        ")",
        "if not exist \"%STAGE%\\apply.cmd\" (",
        "  echo [NewBrain ulit] apply.cmd missing after expand>> \"%LOG%\"",
        "  echo ERROR: incomplete payload, apply.cmd missing. See %LOG%",
        "  if exist \"%FAILUI%\" powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File \"%FAILUI%\" "
        "-ExitCode 1 -LogPath \"%LOG%\"",
        "  exit /B 1",
        ")",
        "echo [NewBrain ulit] calling apply.cmd>> \"%LOG%\"",
        "if defined REQUESTED_ROOT (",
        "  call \"%STAGE%\\apply.cmd\" \"!REQUESTED_ROOT!\" >> \"%LOG%\" 2>&1",
        ") else (",
        "  call \"%STAGE%\\apply.cmd\" >> \"%LOG%\" 2>&1",
        ")",
        "set \"ERR=!ERRORLEVEL!\"",
        "echo [NewBrain ulit] apply exit=!ERR!>> \"%LOG%\"",
        "if not \"!ERR!\"==\"0\" (",
        "  if exist \"%FAILUI%\" (",
        "    powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File \"%FAILUI%\" "
        "-ExitCode !ERR! -LogPath \"%LOG%\"",
        "  ) else if exist \"%STAGE%\\show-ulit-failure.ps1\" (",
        "    powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File \"%STAGE%\\show-ulit-failure.ps1\" "
        "-ExitCode !ERR! -LogPath \"%LOG%\"",
        "  ) else (",
        "    echo ERROR: ulit patch failed exit=!ERR!. See %LOG%",
        "  )",
        ")",
        "exit /B !ERR!",
        "",
    ]
    # ASCII-only + CRLF + no BOM so cmd.exe parses reliably on Chinese Windows.
    return ("\r\n".join(lines)).encode("ascii")


def _msi_product_version(version: str) -> str:
    """MSI ProductVersion allows at most 3 numeric fields (X.Y.Z)."""
    cleaned = (version or "").strip().lstrip("vV")
    for suffix in (".ulit", "-ulit", "_ulit", "ulit"):
        if cleaned.lower().endswith(suffix):
            cleaned = cleaned[: -len(suffix)]
            break
    parts: list[str] = []
    for token in cleaned.split("."):
        if token.isdigit():
            parts.append(str(int(token)))
        if len(parts) == 3:
            break
    while len(parts) < 3:
        parts.append("0")
    return ".".join(parts[:3])


def build_msi(stage: Path, output: Path, version: str, base_version: str) -> None:
    import msilib  # type: ignore
    from msilib import schema, sequence  # type: ignore

    if not stage.is_dir():
        raise SystemExit(f"stage directory missing: {stage}")
    for required in (
        "apply.cmd",
        "apply-ulit-patch.cjs",
        "resolve-install-root.ps1",
        "manifest.json",
        "app.asar.bsdiff",
    ):
        if not (stage / required).is_file():
            raise SystemExit(f"missing required patch file: {stage / required}")
    if not (stage / "tools" / "bspatch.exe").is_file():
        raise SystemExit(f"missing {stage / 'tools' / 'bspatch.exe'}")

    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()

    # Prefer ProgramData so applicator staging does not depend on per-user LocalAppData
    # (broken/redirected profiles) and so elevated apply can write Program Files\NewBrain.
    program_data = os.environ.get("ProgramData") or r"C:\ProgramData"
    product_version = _msi_product_version(version)
    install_dir = str(Path(program_data) / f"NewBrain-ulit-{product_version}") + os.sep
    product_code = _gen_uuid()
    # Stable upgrade code for this applicator product line (not the Electron product).
    upgrade_code = "{A7C0E11D-9B2F-4D55-9C3A-7E1D00010A7C}"
    product_name = f"NewBrain Ulit Patch {product_version}"

    with tempfile.TemporaryDirectory(prefix="ulit-msi-") as tmp:
        tmp_path = Path(tmp)
        payload_base = tmp_path / "payload.ulit"
        shutil.make_archive(str(payload_base), "zip", root_dir=stage)
        payload_zip = tmp_path / "payload.ulit.zip"
        if not payload_zip.is_file():
            raise SystemExit("failed to create payload.ulit.zip")

        bootstrap = tmp_path / "bootstrap.cmd"
        bootstrap.write_bytes(_bootstrap_cmd_bytes())

        # PowerShell entry is the msiexec CA target. Stale UTF-8-BOM / CJK bootstrap.cmd
        # left in INSTALLDIR from earlier builds exits 255 instantly (user-visible 闪退).
        run_ps1_src = stage / "run-ulit-bootstrap.ps1"
        if not run_ps1_src.is_file():
            # Fall back to repo template next to this builder when stage is payload-only.
            run_ps1_src = Path(__file__).resolve().parent / "ulit-patch" / "run-ulit-bootstrap.ps1"
        if not run_ps1_src.is_file():
            raise SystemExit(f"missing run-ulit-bootstrap.ps1 (stage or template)")
        shutil.copy2(run_ps1_src, tmp_path / "run-ulit-bootstrap.ps1")

        fail_ps1_src = stage / "show-ulit-failure.ps1"
        if not fail_ps1_src.is_file():
            fail_ps1_src = Path(__file__).resolve().parent / "ulit-patch" / "show-ulit-failure.ps1"
        if not fail_ps1_src.is_file():
            raise SystemExit("missing show-ulit-failure.ps1")
        shutil.copy2(fail_ps1_src, tmp_path / "show-ulit-failure.ps1")

        db = msilib.init_database(
            str(output),
            schema,
            product_name,
            product_code,
            product_version,
            "NewBrain",
        )
        msilib.add_tables(db, sequence)

        # init_database already seeds Product* properties. Insert only extras;
        # duplicates cause MSI error 2259 on Property primary key.
        def upsert_property(name: str, value: str) -> None:
            view = db.OpenView(f"SELECT `Value` FROM `Property` WHERE `Property`='{name}'")
            view.Execute(None)
            row = view.Fetch()
            view.Close()
            if row is None:
                msilib.add_data(db, "Property", [(name, value)])
            else:
                view = db.OpenView(
                    f"UPDATE `Property` SET `Value`='{value.replace(chr(39), '')}' "
                    f"WHERE `Property`='{name}'"
                )
                view.Execute(None)
                view.Close()

        upsert_property("UpgradeCode", upgrade_code)
        # Per-machine: UAC elevate so bspatch can replace Program Files\NewBrain\resources\app.asar.
        # Per-user LocalAppData applicators cannot write machine installs.
        upsert_property("ALLUSERS", "1")
        upsert_property("INSTALLDIR", install_dir)
        # Force overwrite of unversioned applicator files on repair/reinstall so a
        # leftover Chinese/BOM bootstrap.cmd cannot keep winning.
        upsert_property("REINSTALLMODE", "amus")
        # Allow msiexec APPLICATIONFOLDER=... to flow into the execute sequence.
        # Do not insert APPLICATIONFOLDER with an empty Value (msilib rejects "").
        upsert_property(
            "SecureCustomProperties",
            "APPLICATIONFOLDER;OLDULITFOUND;REINSTALLMODE;ALLUSERS",
        )
        upsert_property(
            "ARPCOMMENTS",
            f"Applies app.asar bsdiff {base_version} to {version}; not a full Electron MSI.",
        )

        # Remove prior applicator installs that share UpgradeCode (same INSTALLDIR).
        msilib.add_data(
            db,
            "Upgrade",
            [(upgrade_code, "", "99.0.0", "", 0, None, "OLDULITFOUND")],
        )

        feature = msilib.Feature(
            db,
            "UlitPatchFeature",
            "UlitPatch",
            "NewBrain ulit patch applicator",
            1,
            1,
        )

        cab = msilib.CAB("ulitcab")
        root = msilib.Directory(db, cab, None, str(tmp_path), "TARGETDIR", "SourceDir")
        # CA type 34 Source must be a Directory-table key. SystemFolder is NOT seeded
        # by msilib.init_database / Directory(TARGETDIR) alone. Missing rows cause
        # msiexec error 2727 ("The directory entry 'SystemFolder' does not exist").
        # Keep the standard TARGETDIR -> WindowsFolder -> SystemFolder hierarchy so
        # Windows Installer resolves SystemFolder to %SystemRoot%\System32.
        msilib.add_data(
            db,
            "Directory",
            [
                ("WindowsFolder", "TARGETDIR", "Windows"),
                ("SystemFolder", "WindowsFolder", "System"),
            ],
        )
        # Keep msilib's uniqueness set in sync so later Directory() calls cannot
        # accidentally reuse these logical names.
        msilib._directories.update({"WindowsFolder", "SystemFolder"})
        install = msilib.Directory(
            db,
            cab,
            root,
            str(tmp_path),
            "INSTALLDIR",
            f"NewBrain-ulit-{product_version}|NewBrain_ulit",
        )
        # Keypath is the PowerShell entry (new file) so dirty INSTALLDIR leftovers
        # cannot keep the CA pointed at a broken bootstrap.cmd.
        install.start_component(
            "UlitPayloadComp", feature, 0, "run-ulit-bootstrap.ps1", _gen_uuid()
        )
        install.add_file("run-ulit-bootstrap.ps1")
        install.add_file("show-ulit-failure.ps1")
        install.add_file("bootstrap.cmd")
        install.add_file("payload.ulit.zip")
        cab.commit(db)

        # Root cause fix (1721): CA type 34 uses CreateProcess. CreateProcess cannot
        # launch .cmd/.bat directly -> MSI error "A program required for this install
        # to complete could not be run." Always go through an absolute exe path.
        #
        # Working directory MUST be SystemFolder so CreateProcess reliably finds
        # powershell/cmd even when MSI deferred/post-finalize PATH is empty.
        #
        # CRITICAL flash-quit (1722 / exit 255): launching a stale UTF-8-BOM / CJK
        # bootstrap.cmd via cmd.exe exits 255 with no MessageBox. Prefer PowerShell
        # entry run-ulit-bootstrap.ps1 (UTF-8 safe + Chinese MessageBox on failure).
        # Pass install root as plain arg with trailing sentinel "." .
        ca_target = (
            '"[SystemFolder]WindowsPowerShell\\v1.0\\powershell.exe" '
            "-NoProfile -STA -ExecutionPolicy Bypass -File "
            '"[INSTALLDIR]run-ulit-bootstrap.ps1" "[APPLICATIONFOLDER]."'
        )
        msilib.add_data(
            db,
            "CustomAction",
            [("RunUlitBootstrap", 34, "SystemFolder", ca_target)],
        )

        def upsert_sequence(action: str, condition: str | None, seq: int) -> None:
            view = db.OpenView(
                f"SELECT `Condition`,`Sequence` FROM `InstallExecuteSequence` "
                f"WHERE `Action`='{action}'"
            )
            view.Execute(None)
            row = view.Fetch()
            view.Close()
            cond_sql = "NULL" if condition is None else f"'{condition.replace(chr(39), '')}'"
            if row is None:
                msilib.add_data(
                    db,
                    "InstallExecuteSequence",
                    [(action, condition, seq)],
                )
            else:
                view = db.OpenView(
                    f"UPDATE `InstallExecuteSequence` "
                    f"SET `Condition`={cond_sql}, `Sequence`={int(seq)} "
                    f"WHERE `Action`='{action}'"
                )
                view.Execute(None)
                view.Close()

        # Remove prior ulit applicators (same UpgradeCode). FindRelatedProducts is
        # already in the default msilib sequence and reads the Upgrade table.
        upsert_sequence("RemoveExistingProducts", "OLDULITFOUND", 1450)
        # After InstallFinalize (6600): files are committed on disk.
        upsert_sequence("RunUlitBootstrap", "NOT REMOVE", 6602)
        db.Commit()

    size = output.stat().st_size
    if size <= 1024 * 100:
        raise SystemExit(f"MSI output looks truncated ({size} bytes)")
    if size > 40 * 1024 * 1024:
        print(f"WARNING: applicator MSI is large ({size} bytes)", file=sys.stderr)
    print(f"Wrote {output} ({size} bytes)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build NewBrain ulit MSI applicator")
    parser.add_argument("--stage", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--base-version", required=True)
    args = parser.parse_args()
    build_msi(Path(args.stage), Path(args.output), args.version, args.base_version)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
