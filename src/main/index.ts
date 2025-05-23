import { app, shell, BrowserWindow, ipcMain, dialog, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { autoUpdater } from 'electron-updater'
import { binaryNames, binaryPath, checkOllama, checkSize, downloadBinaries, installOllamaLinux } from './ollama-binaries'
import os from 'os'
import fs from 'fs'
import { exec } from 'child_process'
import process from 'node:process'
import { webSearch, webSearchType } from './websearch'
import { puppeteerSearch } from './puppeteer'
import { deleteVectorDb, getFileName, getSelectedFiles, getVectorDbList, saveVectorDb, similaritySearch } from './utils/rag-utils'
import { generateDocs } from './utils/docs-generator'
import path from 'path'
import pie from "puppeteer-in-electron"
import puppeteer from "puppeteer-core";
// Handling dynamic imports the shell-path module, provides asynchronous functions
(async (): Promise<void> => {
  const { shellPathSync } = await import('shell-path')
  // This function fixes the shell errors for mac and possibly linux
  // The original code has been referenced from here: https://github.com/sindresorhus
  function fixPath(): void {
    if (process.platform === 'win32') {
      return
    }

    process.env.PATH =
      shellPathSync() ||
      ['./node_modules/.bin', '/.nodebrew/current/bin', '/usr/local/bin', process.env.PATH].join(
        ':'
      )
  }

  fixPath()
})()


function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    titleBarStyle: 'hidden',
    frame: true,
    roundedCorners: true,
    backgroundMaterial: 'acrylic',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// exporting downloads directory
export const downloadDirectory = app.getPath('downloads')
export const documentsDirectory = app.getPath('documents')
// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Autoupdater
  autoUpdater.checkForUpdatesAndNotify()
  autoUpdater.on('update-downloaded', () => {
    dialog
      .showMessageBox({
        title: 'Update Downloaded!',
        message: 'A new version has been downloaded!',
        buttons: ['Go Ahead', 'Release Notes', 'Later'],
        detail: 'LLocal will be closed and the update will be installed!'
      })
      .then((click) => {
        if (click.response === 0) {
          autoUpdater.quitAndInstall()
        }
        if (click.response === 1) {
          shell.openExternal('https://github.com/kartikm7/llocal/releases')
        }
      })
  })

  // Serving ollama, if not present then performing the download function
  async function checkingOllama(): Promise<boolean> {
    const check = await checkOllama()
    console.log('Checking ollama', check)
    return check
  }

  const platform = os.platform()
  const downloadPath = binaryPath(platform)

  // Checking if binaries already exist
  async function checkingBinaries(): Promise<boolean> {
    return new Promise((resolve) => {
      if (fs.existsSync(downloadPath[0])) {
        resolve(true)
      } else {
        console.log('Checking behavior', false)
        resolve(false)
      }
    })
  }

  async function checkingBinarySize(): Promise<boolean> {
    const currentPath = downloadPath[0]
    const llocalSize: number = fs.statSync(currentPath).size
    return await checkSize(binaryNames[platform].name, llocalSize)
  }

  //  used when ollama is not downloaded
  async function downloadingOllama(): Promise<string> {
    const check = await checkOllama()
    if (!check) {
      // in the case where the platform is linux we execute this command and the rest is handled
      if (platform == 'linux') {
        const response = await installOllamaLinux()
        return response
      }
      // ollama is downloading
      const response = await downloadBinaries()
      if (response == 'success') {
        // ollama has been downloaded
        return 'success'
      } else {
        return 'download-failed'
      }
    }
    return 'already-present'
  }

  async function installingOllama(): Promise<boolean> {
    return new Promise((resolve) => {
      // mac-os has an edge case that needs to be dealt with
      if (platform == 'linux') {
        const check = checkingOllama() // we just check incase
        resolve(check) // resolve the check
      }
      if (platform == 'darwin') {
        // the path to the directory where it's extracting
        const extractDirectory = downloadPath[1].replace('/Ollama-darwin.zip', '')
        // this script ensures, the zip gets extracted and has the required permisions to execute
        exec(
          `unzip ${downloadPath[1]} -d ${extractDirectory} && chmod +x ${extractDirectory}/Ollama.app && ${extractDirectory}/Ollama.app/Contents/MacOS/Ollama`,
          (error) => {
            if (error == null) {
              // ollama has been installed
              resolve(true)
            } else {
              resolve(false)
            }
          }
        )
      } else {
        // so much easier on windows, with linux hopefully the logic just needs to be appended with mac
        exec(downloadPath[1], (error) => {
          if (error == null) {
            // ollama has been installed
            resolve(true)
          } else {
            resolve(false)
          }
        })
      }
    })
  }

  // the handlers are for interprocess communication
  ipcMain.handle('checkingOllama', async () => {
    const response = await checkingOllama()
    return response
  })

  ipcMain.handle('checkingBinaries', async () => {
    const response = await checkingBinaries()
    return response
  })

  ipcMain.handle('checkingBinarySize', async () => {
    const response = await checkingBinarySize()
    return response
  })

  ipcMain.handle('downloadingOllama', async () => {
    const response = await downloadingOllama()
    return response
  })

  ipcMain.handle('installingOllama', async () => {
    const response = await installingOllama()
    return response
  })

  ipcMain.handle('checkVersion', async () => {
    return new Promise((resolve) => {
      resolve(app.getVersion())
    })
  })

  ipcMain.handle('checkPlatform', async () => {
    return new Promise((resolve) => {
      resolve(platform)
    })
  })

  ipcMain.handle('experimentalSearch', async (_event, searchQuery: string, links: string[]) => {
    let response: webSearchType
    if (links.length > 0) response = await puppeteerSearch(searchQuery, links)
    else response = await webSearch(searchQuery)
    return response
  })

  ipcMain.handle('addKnowledge', async (): Promise<addKnowledgeType> => {
    const { filePaths } = await getSelectedFiles()
    const fileName = getFileName(filePaths[0]);
    const docs = await generateDocs(filePaths[0]);
    const dir = path.join(app.getPath('documents'), 'LLocal', 'Knowledge Base', fileName)
    await saveVectorDb(docs, dir)
    return { path: dir, fileName: fileName };
  })

  ipcMain.handle('similaritySearch', async (_event, selectedKnowledge: addKnowledgeType[], prompt: string): Promise<ragReturn> => {
    const response = await similaritySearch(selectedKnowledge, prompt)
    return response
  })

  ipcMain.handle('getVectorDbList', async (): Promise<addKnowledgeType[]> => {
    return new Promise((resolve) => {
      resolve(getVectorDbList())
    })
  })

  ipcMain.handle('deleteVectorDb', async (_event, indexPath): Promise<boolean> => {
    return new Promise((resolve) => {
      resolve(deleteVectorDb(indexPath))
    })
  })

  createWindow()

  app.on('activate', async function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })


  const primaryDisplay = screen.getPrimaryDisplay()
  const workAreaSize = primaryDisplay.workAreaSize
  let previousBounds = { width: 900, height: 670 }
  const [mainWindow] = BrowserWindow.getAllWindows()
  ipcMain.on('titleBar', (_, event: string): void => {
    switch (event) {
      case 'minimize':
        mainWindow.minimize()
        break;
      case 'maximize':
        // this checks if the browser windows current size is less than (<) the max bounds of space left or not
        // incase it is less, then it emulates a maximize although it is not a true maximize.
        // But it does a pretty good job in my opinion.
        // Also, since there is a previousBounds variable keeping track of the previous bounds when the browser window and the maximum size available
        // are equal and the maximize event is triggered we simply set the bounds to the previous bounds.
        if (mainWindow.getBounds().width < workAreaSize.width && mainWindow.getBounds().height < workAreaSize.height) {
          previousBounds = mainWindow.getBounds()
          mainWindow.setBounds({ x: 0, y: 0, width: workAreaSize.width, height: workAreaSize.height })
        } else {
          mainWindow.setBounds(previousBounds)
        }
        break;
      case 'close':
        app.quit()
        break;
      default:
        break;
    }
  })
})

// TODO: It might be that, because it's loading directly in the window sometimes on JS driven sites that use the virtualDom,
// the scraping might fail. This can be patch through a hot fix await page.goto('https://www.llocal.in', waituntilsomething: {something})
// but this will load the site twice (would increase inference time)
export const loadWebsite = async (url: string): Promise<string> => {
  // @ts-ignore I think there is a type issue because of versions
  const browser = await pie.connect(app, puppeteer);
  const window = new BrowserWindow({ show: false })
  await window.loadURL(url);
  const page = await pie.getPage(browser, window);
  const content = await page.content()
  return content
}
pie.initialize(app)

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
