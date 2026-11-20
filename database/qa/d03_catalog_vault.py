"""D03 current-user Windows vault and private credential viewer; no stdout secrets."""
import ctypes
from ctypes import wintypes
import json
import os
import zlib

PREFIX = 'ClinicManagement/QA/D03Catalog/'


class Credential(ctypes.Structure):
    _fields_ = [('Flags', wintypes.DWORD), ('Type', wintypes.DWORD), ('TargetName', wintypes.LPWSTR),
                ('Comment', wintypes.LPWSTR), ('LastWritten', wintypes.FILETIME),
                ('CredentialBlobSize', wintypes.DWORD), ('CredentialBlob', ctypes.POINTER(ctypes.c_ubyte)),
                ('Persist', wintypes.DWORD), ('AttributeCount', wintypes.DWORD), ('Attributes', ctypes.c_void_p),
                ('TargetAlias', wintypes.LPWSTR), ('UserName', wintypes.LPWSTR)]


def api():
    if os.name != 'nt':
        raise RuntimeError('Windows host credential context is required')
    dll = ctypes.WinDLL('Advapi32.dll', use_last_error=True)
    dll.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.POINTER(Credential))]
    dll.CredReadW.restype = wintypes.BOOL
    dll.CredWriteW.argtypes = [ctypes.POINTER(Credential), wintypes.DWORD]
    dll.CredWriteW.restype = wintypes.BOOL
    dll.CredFree.argtypes = [ctypes.c_void_p]
    return dll


def read(target):
    if not target.startswith(PREFIX):
        raise ValueError('Unrelated credential target')
    dll = api()
    pointer = ctypes.POINTER(Credential)()
    if not dll.CredReadW(target, 1, 0, ctypes.byref(pointer)):
        if ctypes.get_last_error() == 1168:
            raise KeyError('D03 QA entry not found in this Windows logon context')
        raise OSError(ctypes.get_last_error(), 'D03 QA credential read failed')
    try:
        data = ctypes.string_at(pointer.contents.CredentialBlob, pointer.contents.CredentialBlobSize)
        if not data.startswith(b'CQ3\0'):
            raise RuntimeError('Unexpected D03 QA credential format')
        return json.loads(zlib.decompress(data[4:]).decode('utf-8'))
    finally:
        dll.CredFree(pointer)


def write(target, bundle, create=False):
    if not target.startswith(PREFIX):
        raise ValueError('Unrelated credential target')
    try:
        current = read(target)
    except KeyError:
        if not create:
            raise RuntimeError('D03 QA credential entry must already exist') from None
    else:
        if create or current.get('fixture_id') != bundle.get('fixture_id'):
            raise RuntimeError('Refusing to overwrite an unrelated/existing fixture bundle')
    blob = b'CQ3\0' + zlib.compress(json.dumps(bundle, separators=(',', ':')).encode('utf-8'))
    if len(blob) > 2560:
        raise RuntimeError('D03 bundle exceeds the generic credential blob limit')
    buffer = (ctypes.c_ubyte * len(blob)).from_buffer_copy(blob)
    c = Credential()
    c.Type, c.Persist, c.TargetName = 1, 2, target
    c.Comment, c.UserName = 'Isolated D03 QA catalog; no production data', 'Clinic D03 QA fixture bundle'
    c.CredentialBlobSize = len(blob)
    c.CredentialBlob = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))
    if not api().CredWriteW(ctypes.byref(c), 0):
        raise OSError(ctypes.get_last_error(), 'D03 credential write failed')
    if read(target) != bundle:
        raise RuntimeError('D03 credential read-back mismatch')


def view(target):
    import tkinter as tk
    from tkinter import ttk
    bundle = read(target)
    w = tk.Tk()
    w.title('Clinic D03 QA — private host handoff')
    w.geometry('900x470')
    role = tk.StringVar(value='ADMIN')
    url, email, password = tk.StringVar(value=bundle['api_base_url']), tk.StringVar(), tk.StringVar()
    copied = None
    def update(*_):
        account = bundle['accounts'][role.get()]
        email.set(account['email']); password.set(account['password'])
    def copy(value):
        nonlocal copied
        copied = value
        w.clipboard_clear(); w.clipboard_append(value)
        def clear():
            try:
                if w.clipboard_get() == value:
                    w.clipboard_clear()
            except tk.TclError:
                pass
        w.after(30000, clear)
    def close():
        try:
            if copied is not None and w.clipboard_get() == copied:
                w.clipboard_clear()
        except tk.TclError:
            pass
        w.destroy()
    w.protocol('WM_DELETE_WINDOW', close)
    role.trace_add('write', update)
    ttk.Label(w, text='Local QA only. Do not capture or export credentials/tokens. API base URL has no /api/v1 suffix.').grid(row=0, column=0, columnspan=3, pady=12)
    ttk.Combobox(w, textvariable=role, values=list(bundle['accounts']), state='readonly', width=30).grid(row=1, column=1, sticky='w')
    for row, label, variable in [(2, 'API base URL', url), (3, 'Email', email), (4, 'Password', password)]:
        ttk.Label(w, text=label).grid(row=row, column=0, padx=12, pady=8)
        ttk.Entry(w, textvariable=variable, width=75, state='readonly', show='*' if row == 4 else '').grid(row=row, column=1)
        ttk.Button(w, text='Copy', command=lambda v=variable: copy(v.get())).grid(row=row, column=2, padx=10)
    ids = tk.Text(w, width=95, height=12)
    ids.grid(row=5, column=0, columnspan=3, padx=12, pady=12)
    ids.insert('1.0', json.dumps(bundle.get('fixture_ids', {}), indent=2))
    ids.configure(state='disabled')
    update(); w.mainloop()
