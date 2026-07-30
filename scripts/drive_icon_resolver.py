"""
此电脑 / 资源管理器侧边栏 图标「名称解析」正确做法（参考实现）
==========================================================
原 Drive Icon Manager 读不到名称的根因：
  它读的是 NameSpace 子项的 (默认) 值（winreg.QueryValueEx(subkey, None)），但：
    - 第三方图标（如百度网盘）的 (默认) 值是空的，真名在 HKCR\CLSID\{GUID} 默认值里；
    - 系统文件夹（下载/音乐…）的 (默认) 值是内部类名 CLSID_ThisPCDownloadsRegFolder，
      真名由 Explorer 在运行时通过 Shell API 解析，不写在注册表里。

正确解析顺序（三档回退）：
  1) NameSpace 子项 (默认) —— 仅当非空且不像 "CLSID_*" 内部标记时用；
  2) HKCR\CLSID\{GUID} 默认值；若有 LocalizedString 则用 SHLoadIndirectString 解析（第三方/本地化）；
  3) 对仍拿不到名的，用 SHParseDisplayName("::{此电脑}\\::{GUID}") + SHGetNameFromIDList
     取得系统文件夹的本地化显示名（下载/音乐/文档/图片/视频）。
"""
import winreg
import ctypes
import ctypes.wintypes as wt

THIS_PC_GUID = "{20D04FE0-3AEA-1069-A2D8-08002B30309D}"
SIGDN_NORMALDISPLAY = 0

# ---- Shell API 绑定 ----
_shlis = ctypes.windll.shlwapi.SHLoadIndirectString
_shlis.argtypes = [wt.LPCWSTR, wt.LPWSTR, wt.DWORD, ctypes.c_void_p]
_shlis.restype = wt.DWORD

_shell = ctypes.windll.shell32
_ole = ctypes.windll.ole32
_shell.SHParseDisplayName.argtypes = [wt.LPCWSTR, ctypes.c_void_p,
                                      ctypes.POINTER(ctypes.c_void_p), wt.DWORD,
                                      ctypes.POINTER(wt.DWORD)]
_shell.SHParseDisplayName.restype = ctypes.c_long
_shell.SHGetNameFromIDList.argtypes = [ctypes.c_void_p, wt.DWORD, ctypes.POINTER(ctypes.c_wchar_p)]
_shell.SHGetNameFromIDList.restype = ctypes.c_long
_shell.ILFree.argtypes = [ctypes.c_void_p]


def _resolve_indirect(s):
    """把 @C:\\...\\dll,-123 这种资源串解析成本地化文本。"""
    if not s or not s.startswith("@"):
        return s
    buf = ctypes.create_unicode_buffer(1024)
    if _shlis(s, buf, 1024, None) == 0:
        return buf.value
    return s


def _shell_name(guid):
    """档 3：经「此电脑」命名空间解析系统文件夹本地化名。"""
    path = "::" + THIS_PC_GUID + "\\::" + guid
    pidl = ctypes.c_void_p()
    attrs = wt.DWORD(0)
    if _shell.SHParseDisplayName(path, None, ctypes.byref(pidl), 0, ctypes.byref(attrs)) != 0:
        return None
    psz = ctypes.c_wchar_p()
    hr = _shell.SHGetNameFromIDList(pidl, SIGDN_NORMALDISPLAY, ctypes.byref(psz))
    name = psz.value if (hr == 0 and psz) else None
    if psz:
        _ole.CoTaskMemFree(psz)
    _shell.ILFree(pidl)
    return name


def get_display_name(guid, namespace_default=""):
    """三档回退，返回可读的图标名称。"""
    # 档 2：CLSID 注册
    clsid_default = ""
    loc = ""
    try:
        ck = winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, "CLSID\\" + guid)
        try:
            clsid_default, _ = winreg.QueryValueEx(ck, None)
        except FileNotFoundError:
            pass
        try:
            loc, _ = winreg.QueryValueEx(ck, "LocalizedString")
        except FileNotFoundError:
            pass
        winreg.CloseKey(ck)
    except Exception:
        pass

    if loc:
        return _resolve_indirect(loc)
    if clsid_default:
        return clsid_default

    # 档 1：NameSpace 子项默认值（排除内部类名标记）
    if namespace_default and not namespace_default.startswith("CLSID_"):
        return namespace_default

    # 档 3：Shell API
    s = _shell_name(guid)
    if s:
        return s
    return "无显示名称"


def list_drive_icons(base_key, path, source):
    """等价于原 list_drive_icons，但名称能被正确解析。"""
    icons = []
    try:
        key = winreg.OpenKey(base_key, path, 0, winreg.KEY_READ)
    except Exception:
        return icons
    i = 0
    while True:
        try:
            subkey_name = winreg.EnumKey(key, i)
        except OSError:
            break
        i += 1
        if subkey_name == "DelegateFolders":
            continue  # 容器，跳过
        subkey_path = path + "\\" + subkey_name
        ns_default = ""
        try:
            sk = winreg.OpenKey(base_key, subkey_path, 0, winreg.KEY_READ)
            try:
                ns_default, _ = winreg.QueryValueEx(sk, None)
            except FileNotFoundError:
                pass
            winreg.CloseKey(sk)
        except Exception:
            pass
        display = get_display_name(subkey_name, ns_default)
        icons.append((subkey_name, display, source))
    winreg.CloseKey(key)
    return icons


if __name__ == "__main__":
    print("HKCU 此电脑:")
    for g, n, _ in list_drive_icons(winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\MyComputer\NameSpace", "此电脑"):
        print(f"  {n}  <{g}>")
    print("HKLM 此电脑:")
    for g, n, _ in list_drive_icons(winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\MyComputer\NameSpace", "此电脑2"):
        print(f"  {n}  <{g}>")
