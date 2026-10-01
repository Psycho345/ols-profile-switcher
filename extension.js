
const vscode = require("vscode");
const fs = require("fs/promises");
const path = require("path");

const REFRESH_DELAY = 300;

let statusBar;
let watcher;
let refreshTimer;
let currentFolder;
let disposed = false;

function getConfigPath(folder) {
    return path.join(folder.uri.fsPath, "ols.json");
}

async function readConfig(folder) {
    const configPath = getConfigPath(folder);
    const content = await fs.readFile(configPath, "utf8");
    //Strip UTF-8 BOM because it doesn't parse with BOM
    return JSON.parse(content.replace(/^\uFEFF/, ""));
}

function getProfiles(config) {
    if (!Array.isArray(config.profiles)) {
        return [];
    }

    return config.profiles
        .map(profile => typeof profile === "string"
            ? profile
            : profile?.name)
        .filter(name => typeof name === "string" && name.length > 0);
}

function getActiveFolder() {
    const folders = vscode.workspace.workspaceFolders || [];

    if (folders.length === 0) {
        return undefined;
    }

    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (folder) {
            return folder;
        }
    }

    return folders[0];
}

async function updateStatusBar() {
    if (disposed || !statusBar) return;

    const folder = getActiveFolder();
    currentFolder = folder;

    if (!folder) {
        statusBar.hide();
        return;
    }

    try {
        const config = await readConfig(folder);
        const profiles = getProfiles(config);
        const active = config.profile;

        if (profiles.length === 0) {
            statusBar.text = "$(warning) OLS: No profiles";
            statusBar.tooltip = "No profiles found in ols.json";
            statusBar.show();
            return;
        }

        if (!profiles.includes(active)) {
            statusBar.text = `$(warning) OLS: ${active || "Unknown"}`;
            statusBar.tooltip =
                "The active profile isn't listed in ols.json";
        } else {
            statusBar.text = `OLS: ${active}`;
            statusBar.tooltip =
                `Active OLS profile: ${active}\n` +
                "Click to switch profiles";
        }

        statusBar.show();
    } catch (error) {
        if (error.code === "ENOENT") {
            statusBar.hide();
            return;
        }

        statusBar.text = "$(warning) OLS: Error";
        statusBar.tooltip = `Could not read ols.json: ${error.message}`;
        statusBar.show();
    }
}

async function selectProfile() {
    const folder = getActiveFolder();

    if (!folder) {
        vscode.window.showInformationMessage("Open a workspace containing ols.json first.");
        return;
    }

    let config;
    try {
        config = await readConfig(folder);
    } catch (error) {
        vscode.window.showErrorMessage(`Could not read ols.json: ${error.message}`);
        return;
    }

    const profiles = getProfiles(config);

    if (profiles.length === 0) {
        vscode.window.showWarningMessage("No profiles found in ols.json.");
        return;
    }

    const items = profiles.map(name => ({
        label: name === config.profile
            ? `$(check) ${name}`
            : `$(circle-outline) ${name}`,
        description: name === config.profile ? "Current profile" : ""
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select an OLS profile",
        title: "OLS Profile Switcher",
        matchOnDescription: false
    });

    if (!selected) return;

    const newProfile = profiles.find(name => selected.label.endsWith(name));

    if (!newProfile || newProfile === config.profile) {
        return;
    }

    const configPath = getConfigPath(folder);

    try {
        //Read again just in case the file changed after opening the picker
        const latest = await readConfig(folder);
        const latestProfiles = getProfiles(latest);

        if (!latestProfiles.includes(newProfile)) {
            throw new Error("The selected profile no longer exists.");
        }

        latest.profile = newProfile;

        await fs.writeFile(configPath, JSON.stringify(latest, null, 4) + "\n", "utf8");

        await updateStatusBar();

        vscode.window.showInformationMessage(
            `OLS profile switched to: ${newProfile}`
        );
    } catch (error) {
        vscode.window.showErrorMessage(
            `Failed to switch OLS profile: ${error.message}`
        );
    }
}

function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(updateStatusBar, REFRESH_DELAY);
}

function activate(context) {
    disposed = false;

    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.command = "olsProfileSwitcher.selectProfile";
    statusBar.name = "OLS Profile";
    statusBar.text = "$(sync) OLS: Loading...";
    statusBar.show();
    context.subscriptions.push(statusBar);

    context.subscriptions.push(vscode.commands.registerCommand("olsProfileSwitcher.selectProfile", selectProfile));

    context.subscriptions.push(vscode.commands.registerCommand("olsProfileSwitcher.refresh", updateStatusBar));

    watcher = vscode.workspace.createFileSystemWatcher("**/ols.json");

    watcher.onDidChange(scheduleRefresh);
    watcher.onDidCreate(scheduleRefresh);
    watcher.onDidDelete(scheduleRefresh);

    context.subscriptions.push(watcher);

    //Refresh when changing workspace
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(scheduleRefresh));
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(scheduleRefresh));

    updateStatusBar();

    context.subscriptions.push({
        dispose() {
            disposed = true;
            clearTimeout(refreshTimer);
        }
    });
}

function deactivate() {
    disposed = true;
    clearTimeout(refreshTimer);
    if (watcher) watcher.dispose();
    if (statusBar) statusBar.dispose();
}

module.exports = {
    activate,
    deactivate
};