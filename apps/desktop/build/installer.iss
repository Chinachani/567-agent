#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef SourceDir
  #error SourceDir is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif
#ifndef Arch
  #error Arch is required
#endif

[Setup]
AppId={{A2B92798-AB76-4F6B-A9B9-C252DBCB617C}
AppName=567 Agent
AppVerName=567 Agent {#AppVersion}
AppVersion={#AppVersion}
AppPublisher=567wiki
DefaultDirName={localappdata}\Programs\567Agent
DefaultGroupName=567 Agent
OutputDir={#OutputDir}
OutputBaseFilename=567-Agent-{#AppVersion}-win-{#Arch}
SetupIconFile={#SourceDir}\versions\{#AppVersion}\resources\build\icon.ico
UninstallDisplayIcon={app}\567-Agent.exe
Compression=lzma2/max
SolidCompression=no
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
AllowNoIcons=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no
MinVersion=10.0
VersionInfoVersion={#AppVersion}
Uninstallable=not IsBackgroundUpdate
CreateUninstallRegKey=not IsBackgroundUpdate

#if Arch == "x64"
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#else
  #error Unsupported architecture
#endif

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Default.isl,{#SourcePath}\installer.zh-cn.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
chinesesimplified.DataFolderCaption=数据存放位置
chinesesimplified.DataFolderDescription=选择 567 Agent 的数据文件夹。应用会话、配置、凭据、应用技能、知识库、Electron 配置和自动更新文件都会保存在此处。更换位置时，安装程序会复制旧数据并保留原目录。
chinesesimplified.DataFolderPrompt=数据文件夹：
chinesesimplified.DataMigrationFailed=无法迁移数据目录（错误代码 %1）。原目录中的数据未删除。请检查目标磁盘空间和文件权限后重试。
chinesesimplified.DataMigrationOverlap=数据目录与旧数据目录重叠，无法安全迁移。请选择一个独立文件夹。
chinesesimplified.DataMigrationStatus=正在迁移 567 Agent 数据，请保持安装程序运行……
english.DataFolderCaption=Data location
english.DataFolderDescription=Choose where 567 Agent stores its data. App conversations, settings, credentials, installed app skills, knowledge, Electron profile, and update files are stored here. When changing locations, setup copies the old data and keeps the original folders.
english.DataFolderPrompt=Data folder:
english.DataMigrationFailed=The data folder could not be migrated (error code %1). The original data has not been deleted. Check disk space and permissions, then try again.
english.DataMigrationOverlap=The selected data folder overlaps an existing data folder and cannot be migrated safely. Choose a separate folder.
english.DataMigrationStatus=Migrating 567 Agent data. Keep the installer running…

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; Flags: unchecked

[Dirs]
Name: "{app}\versions"; Check: IsNotBackgroundUpdate

[Files]
Source: "{#SourceDir}\567-Agent.exe"; DestDir: "{app}"; Flags: ignoreversion; Check: IsNotBackgroundUpdate
Source: "{#SourceDir}\current.json"; DestDir: "{app}"; Flags: ignoreversion; Check: IsNotBackgroundUpdate
; app.asar is already an archive. Keeping it uncompressed lets the outer blockmap
; reuse unchanged chunks instead of invalidating one large LZMA2 stream.
Source: "{#SourceDir}\versions\{#AppVersion}\*"; DestDir: "{app}\versions\{#AppVersion}"; Excludes: "resources\app.asar"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: IsNotBackgroundUpdate
Source: "{#SourceDir}\versions\{#AppVersion}\resources\app.asar"; DestDir: "{app}\versions\{#AppVersion}\resources"; Flags: ignoreversion nocompression; Check: IsNotBackgroundUpdate
Source: "{#SourceDir}\versions\{#AppVersion}\*"; DestDir: "{code:GetUpdateVersionDirectory}"; Excludes: "resources\app.asar"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: IsBackgroundUpdate
Source: "{#SourceDir}\versions\{#AppVersion}\resources\app.asar"; DestDir: "{code:GetUpdateVersionDirectory}\resources"; Flags: ignoreversion nocompression; Check: IsBackgroundUpdate

[Icons]
Name: "{group}\567 Agent"; Filename: "{app}\567-Agent.exe"; Check: IsNotBackgroundUpdate
Name: "{autodesktop}\567 Agent"; Filename: "{app}\567-Agent.exe"; Tasks: desktopicon; Check: IsNotBackgroundUpdate

[Registry]
Root: HKCU; Subkey: "Software\Classes\.567plugin"; ValueType: string; ValueName: ""; ValueData: "567Agent.PluginPackage"; Flags: uninsdeletevalue; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\.vettapkg"; ValueType: string; ValueName: ""; ValueData: "567Agent.PluginPackage"; Flags: uninsdeletevalue; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\567Agent.PluginPackage"; ValueType: string; ValueName: ""; ValueData: "567 Agent Plugin Package"; Flags: uninsdeletekey; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\567Agent.PluginPackage\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\567-Agent.exe,0"; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\567Agent.PluginPackage\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\567-Agent.exe"" ""%1"""; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\.567design"; ValueType: string; ValueName: ""; ValueData: "567Agent.DesignShare"; Flags: uninsdeletevalue; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\567Agent.DesignShare"; ValueType: string; ValueName: ""; ValueData: "567 Agent 设计分享包"; Flags: uninsdeletekey; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\567Agent.DesignShare\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\567-Agent.exe,0"; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\567Agent.DesignShare\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\567-Agent.exe"" ""%1"""; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\agent567"; ValueType: string; ValueName: ""; ValueData: "URL:567 Agent Protocol"; Flags: uninsdeletekey; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\agent567"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\agent567\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\567-Agent.exe,0"; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\agent567\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\567-Agent.exe"" ""%1"""; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\vetta"; ValueType: string; ValueName: ""; ValueData: "URL:567 Agent Protocol"; Flags: uninsdeletekey; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\vetta"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\vetta\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\567-Agent.exe,0"; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\Classes\vetta\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\567-Agent.exe"" ""%1"""; Check: IsNotBackgroundUpdate
Root: HKCU; Subkey: "Software\567Agent"; ValueType: string; ValueName: "DataRoot"; ValueData: "{code:GetDataRoot}"; Check: IsNotBackgroundUpdate

[Run]
Filename: "{app}\567-Agent.exe"; Description: "{cm:LaunchProgram,567 Agent}"; Flags: nowait postinstall skipifsilent; Check: IsNotBackgroundUpdate

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\567Agent\versions"
Type: filesandordirs; Name: "{localappdata}\567Agent\installer"
Type: filesandordirs; Name: "{localappdata}\567Agent\staging"
Type: files; Name: "{localappdata}\567Agent\current.json"
Type: filesandordirs; Name: "{localappdata}\567-agent-updater"
Type: filesandordirs; Name: "{code:GetUpdateStoreVersions}"
Type: filesandordirs; Name: "{code:GetUpdateStoreInstaller}"
Type: filesandordirs; Name: "{code:GetUpdateStoreStaging}"
Type: files; Name: "{code:GetUpdateStorePointer}"
Type: filesandordirs; Name: "{code:GetUpdaterCacheDirectory}"

[Code]
var
  LastReportedProgress: Integer;
  DataDirectoryPage: TInputDirWizardPage;

const
  AppRegistrySubkey = 'Software\567Agent';
  DataRootValueName = 'DataRoot';

function CreateHardLinkW(
  NewFileName: String;
  ExistingFileName: String;
  SecurityAttributes: LongWord
): Boolean;
  external 'CreateHardLinkW@kernel32.dll stdcall';

function IsBackgroundUpdate(): Boolean;
begin
  Result := CompareText(ExpandConstant('{param:VETTAUPDATE|false}'), 'true') = 0;
end;

function IsNotBackgroundUpdate(): Boolean;
begin
  Result := not IsBackgroundUpdate();
end;

function GetUpdateStoreRoot(Value: String): String; forward;
function GetUpdaterCacheDirectory(Value: String): String; forward;

function GetUpdateVersionDirectory(Value: String): String;
begin
  Result := AddBackslash(GetUpdateStoreRoot('')) + 'versions\{#AppVersion}';
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if IsBackgroundUpdate() and
     ((Trim(ExpandConstant('{param:VETTASTOREROOT}')) = '') or
      (Trim(ExpandConstant('{param:VETTADATAROOT}')) = '')) then
  begin
    Log('VETTASTOREROOT and VETTADATAROOT are required for a background update.');
    Result := False;
  end;
end;

procedure SeedUpdaterDifferentialCache();
var
  CacheDirectory: String;
  CachedBlockmapPath: String;
  CachedInstallerPath: String;
  SourceInstallerPath: String;
  TemporaryInstallerPath: String;
begin
  CacheDirectory := GetUpdaterCacheDirectory('');
  CachedBlockmapPath := AddBackslash(CacheDirectory) + 'current.blockmap';
  CachedInstallerPath := AddBackslash(CacheDirectory) + 'installer.exe';
  SourceInstallerPath := ExpandConstant('{srcexe}');
  TemporaryInstallerPath := AddBackslash(CacheDirectory) + 'installer.exe.installing';

  if not ForceDirectories(CacheDirectory) then
  begin
    Log('Unable to create updater cache directory: ' + CacheDirectory);
    exit;
  end;

  DeleteFile(TemporaryInstallerPath);
  if not CreateHardLinkW(TemporaryInstallerPath, SourceInstallerPath, 0) then
  begin
    if not FileCopy(SourceInstallerPath, TemporaryInstallerPath, False) then
    begin
      Log('Unable to stage updater installer cache: ' + SourceInstallerPath);
      exit;
    end;
  end;

  if FileExists(CachedInstallerPath) and not DeleteFile(CachedInstallerPath) then
  begin
    DeleteFile(TemporaryInstallerPath);
    Log('Unable to replace updater installer cache: ' + CachedInstallerPath);
    exit;
  end;

  if not RenameFile(TemporaryInstallerPath, CachedInstallerPath) then
  begin
    DeleteFile(TemporaryInstallerPath);
    Log('Unable to commit updater installer cache: ' + CachedInstallerPath);
    exit;
  end;

  { A manually installed version may replace an older cached installer. Remove
    the old blockmap so electron-updater fetches the matching versioned one. }
  DeleteFile(CachedBlockmapPath);
  Log('Updater differential cache seeded: ' + CachedInstallerPath);
end;

procedure CleanupOldBundledVersions();
var
  VersionsDirectory: String;
  FindRec: TFindRec;
  CandidateDirectory: String;
begin
  if IsBackgroundUpdate() then
    exit;

  VersionsDirectory := AddBackslash(ExpandConstant('{app}')) + 'versions';
  if not DirExists(VersionsDirectory) then
    exit;

  if FindFirst(AddBackslash(VersionsDirectory) + '*', FindRec) then
  begin
    try
      repeat
        if ((FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0) and
           (FindRec.Name <> '.') and (FindRec.Name <> '..') and
           (FindRec.Name <> '{#AppVersion}') then
        begin
          CandidateDirectory := AddBackslash(VersionsDirectory) + FindRec.Name;
          if DelTree(CandidateDirectory, True, True, True) then
            Log('Removed stale bundled version directory: ' + CandidateDirectory)
          else
            Log('Unable to remove stale bundled version directory: ' + CandidateDirectory);
        end;
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
end;

function NormalizePath(Path: String): String;
begin
  Result := RemoveBackslashUnlessRoot(ExpandFileName(Path));
end;

function PathsAreEqual(FirstPath, SecondPath: String): Boolean;
begin
  Result := CompareText(NormalizePath(FirstPath), NormalizePath(SecondPath)) = 0;
end;

function IsNestedPath(ParentPath, ChildPath: String): Boolean;
var
  ParentPrefix: String;
  NormalizedChild: String;
begin
  ParentPrefix := AddBackslash(NormalizePath(ParentPath));
  NormalizedChild := NormalizePath(ChildPath);
  Result := (Length(NormalizedChild) > Length(ParentPrefix)) and
    (CompareText(Copy(NormalizedChild, 1, Length(ParentPrefix)), ParentPrefix) = 0);
end;

function GetSavedDataRoot(): String;
begin
  Result := '';
  if not RegQueryStringValue(HKCU, AppRegistrySubkey, DataRootValueName, Result) or
     (Trim(Result) = '') then
    Result := ExpandConstant('{userprofile}\.567agent');
end;

function GetDataRoot(Value: String): String;
begin
  if IsBackgroundUpdate() then
    Result := ExpandConstant('{param:VETTADATAROOT}')
  else if Assigned(DataDirectoryPage) then
    Result := DataDirectoryPage.Values[0]
  else
    Result := GetSavedDataRoot();
  if Trim(Result) <> '' then
    Result := NormalizePath(Result);
end;

function GetUpdateStoreRoot(Value: String): String;
begin
  if IsBackgroundUpdate() then
    Result := ExpandConstant('{param:VETTASTOREROOT}')
  else
    Result := AddBackslash(GetDataRoot('')) + 'windows-updates';
end;

function GetUpdateStoreVersions(Value: String): String;
begin
  Result := AddBackslash(GetUpdateStoreRoot('')) + 'versions';
end;

function GetUpdateStoreInstaller(Value: String): String;
begin
  Result := AddBackslash(GetUpdateStoreRoot('')) + 'installer';
end;

function GetUpdateStoreStaging(Value: String): String;
begin
  Result := AddBackslash(GetUpdateStoreRoot('')) + 'staging';
end;

function GetUpdateStorePointer(Value: String): String;
begin
  Result := AddBackslash(GetUpdateStoreRoot('')) + 'current.json';
end;

function GetUpdaterCacheDirectory(Value: String): String;
begin
  Result := AddBackslash(GetDataRoot('')) + 'updater-cache\567-agent-updater';
end;

procedure InitializeWizard();
begin
  DataDirectoryPage := CreateInputDirPage(
    wpSelectDir,
    CustomMessage('DataFolderCaption'),
    CustomMessage('DataFolderDescription'),
    CustomMessage('DataFolderPrompt'),
    False,
    ''
  );
  DataDirectoryPage.Add('');
  DataDirectoryPage.Values[0] := GetSavedDataRoot();
end;

function CopyDataDirectory(SourceDirectory, DestinationDirectory: String; var ErrorMessage: String): Boolean;
var
  ResultCode: Integer;
  Parameters: String;
begin
  Result := True;
  if not DirExists(SourceDirectory) or PathsAreEqual(SourceDirectory, DestinationDirectory) then
    exit;

  if IsNestedPath(SourceDirectory, DestinationDirectory) or IsNestedPath(DestinationDirectory, SourceDirectory) then
  begin
    ErrorMessage := CustomMessage('DataMigrationOverlap');
    Result := False;
    exit;
  end;

  Parameters := '"' + SourceDirectory + '" "' + DestinationDirectory +
    '" /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NP';
  if not Exec(ExpandConstant('{sys}\robocopy.exe'), Parameters, '', SW_HIDE,
      ewWaitUntilTerminated, ResultCode) or (ResultCode >= 8) then
  begin
    ErrorMessage := FmtMessage(CustomMessage('DataMigrationFailed'), [IntToStr(ResultCode)]);
    Result := False;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  DataRoot: String;
begin
  Result := '';
  if IsBackgroundUpdate() then
    exit;

  DataRoot := GetDataRoot('');
  if Trim(DataRoot) = '' then
  begin
    Result := CustomMessage('DataMigrationOverlap');
    exit;
  end;
  DataRoot := NormalizePath(DataRoot);
  if (Length(DataRoot) <= 3) or PathsAreEqual(DataRoot, ExpandConstant('{userprofile}\.vetta')) or
     PathsAreEqual(DataRoot, ExpandConstant('{app}')) or
     IsNestedPath(ExpandConstant('{app}'), DataRoot) or IsNestedPath(DataRoot, ExpandConstant('{app}')) then
  begin
    Result := CustomMessage('DataMigrationOverlap');
    exit;
  end;
end;

procedure MigrateDataDirectories();
var
  DataRoot: String;
  PreviousDataRoot: String;
  LegacyDataRoot: String;
  PreviousUpdateRoot: String;
  PreviousUpdaterCache: String;
  ErrorMessage: String;
begin
  if IsBackgroundUpdate() then
    exit;

  DataRoot := GetDataRoot('');
  PreviousDataRoot := GetSavedDataRoot();
  LegacyDataRoot := ExpandConstant('{userprofile}\.vetta');
  PreviousUpdateRoot := AddBackslash(PreviousDataRoot) + 'windows-updates';
  if not DirExists(PreviousUpdateRoot) then
    PreviousUpdateRoot := ExpandConstant('{localappdata}\567Agent');
  PreviousUpdaterCache := AddBackslash(PreviousDataRoot) + 'updater-cache\567-agent-updater';
  if not DirExists(PreviousUpdaterCache) then
    PreviousUpdaterCache := ExpandConstant('{localappdata}\567-agent-updater');

  WizardForm.StatusLabel.Caption := CustomMessage('DataMigrationStatus');
  WizardForm.Update;

  if DirExists(LegacyDataRoot) and
     not CopyDataDirectory(LegacyDataRoot, DataRoot, ErrorMessage) then
    RaiseException(ErrorMessage);
  if not CopyDataDirectory(PreviousDataRoot, DataRoot, ErrorMessage) then
    RaiseException(ErrorMessage);
  if not CopyDataDirectory(ExpandConstant('{userappdata}\567-agent'),
      AddBackslash(DataRoot) + 'electron-user-data', ErrorMessage) then
    RaiseException(ErrorMessage);
  if not CopyDataDirectory(PreviousUpdateRoot, AddBackslash(DataRoot) + 'windows-updates', ErrorMessage) then
    RaiseException(ErrorMessage);
  if not CopyDataDirectory(PreviousUpdaterCache, AddBackslash(DataRoot) + 'updater-cache\567-agent-updater', ErrorMessage) then
    RaiseException(ErrorMessage);

  if not ForceDirectories(DataRoot) then
    RaiseException(CustomMessage('DataMigrationFailed'));
end;

procedure CurInstallProgressChanged(CurProgress, MaxProgress: Integer);
var
  CurrentProgress: Integer;
  ProgressFilePath: String;
begin
  if not IsBackgroundUpdate() then
    exit;

  ProgressFilePath := ExpandConstant('{param:VETTAPROGRESS}');
  if (ProgressFilePath = '') or (MaxProgress <= 0) then
    exit;

  CurrentProgress := (CurProgress * 100) div MaxProgress;
  if CurrentProgress <> LastReportedProgress then
  begin
    LastReportedProgress := CurrentProgress;
    SaveStringToFile(
      ProgressFilePath,
      IntToStr(CurProgress) + ',' + IntToStr(MaxProgress),
      False
    );
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    MigrateDataDirectories();

  if CurStep = ssPostInstall then
  begin
    if IsBackgroundUpdate() then
    begin
      if not SaveStringToFile(
        AddBackslash(GetUpdateVersionDirectory('')) + '.install-complete',
        '{#AppVersion}',
        False
      ) then
        RaiseException('Failed to write update completion marker.');
    end
    else
    begin
      SeedUpdaterDifferentialCache();
      DeleteFile(GetUpdateStorePointer(''));
      CleanupOldBundledVersions();
    end;
  end;
end;
