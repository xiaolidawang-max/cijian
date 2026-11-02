package com.xiaolidawang.cijian;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/** Saves only a user-selected JSON document; no storage permission is needed. */
@CapacitorPlugin(name = "BackupFile")
public class BackupFilePlugin extends Plugin {
    private static final int MAX_BYTES = 2_000_000;
    private final AtomicBoolean saving = new AtomicBoolean(false);

    @PluginMethod
    public void saveFile(PluginCall call) {
        String filename = call.getString("filename");
        String contents = call.getString("contents");
        if (filename == null || filename.trim().isEmpty() || filename.length() > 120
                || !filename.toLowerCase(Locale.ROOT).endsWith(".json")
                || filename.matches("(?s).*[\\p{Cntrl}\\\\/:*?\"<>|].*")) {
            call.reject("备份文件名无效。", "INVALID_FILENAME");
            return;
        }
        if (!validContents(contents)) {
            call.reject("备份内容为空或超过 2 MB。", "INVALID_CONTENTS");
            return;
        }
        if (!saving.compareAndSet(false, true)) {
            call.reject("请先完成当前的备份保存。", "SAVE_IN_PROGRESS");
            return;
        }

        // Capacitor persists pending call options in Activity state. Keep a small
        // private cache token there, never a potentially 2 MB JSON payload.
        File pending = null;
        try {
            pending = File.createTempFile("cijian-backup-", ".json", getContext().getCacheDir());
            try (FileOutputStream output = new FileOutputStream(pending)) {
                output.write(contents.getBytes(StandardCharsets.UTF_8));
            }
            call.getData().remove("contents");
            call.getData().put("_pendingFile", pending.getName());
        } catch (IOException | RuntimeException error) {
            if (pending != null) pending.delete();
            saving.set(false);
            call.reject("无法准备备份文件，请检查手机剩余空间。", "PREPARE_FAILED", error);
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
        getBridge().executeOnMainThread(() -> {
            try {
                startActivityForResult(call, intent, "documentCreated");
            } catch (RuntimeException error) {
                deletePending(call);
                saving.set(false);
                call.reject("无法打开系统文件保存窗口。", "PICKER_UNAVAILABLE", error);
            }
        });
    }

    private static boolean validContents(String contents) {
        return contents != null && !contents.isEmpty() && contents.length() <= MAX_BYTES
                && contents.getBytes(StandardCharsets.UTF_8).length <= MAX_BYTES;
    }

    private File pendingFile(PluginCall call) throws IOException {
        String name = call.getString("_pendingFile");
        if (name == null || !name.startsWith("cijian-backup-") || !name.endsWith(".json")
                || !name.equals(new File(name).getName())) throw new IOException("Invalid backup cache token");
        File directory = getContext().getCacheDir().getCanonicalFile();
        File file = new File(directory, name).getCanonicalFile();
        if (!directory.equals(file.getParentFile())) throw new IOException("Invalid backup cache location");
        return file;
    }

    private byte[] readPending(PluginCall call) throws IOException {
        File file = pendingFile(call);
        if (file.length() <= 0 || file.length() > MAX_BYTES) throw new IOException("Backup cache missing or invalid");
        try (FileInputStream input = new FileInputStream(file);
                ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (bytes.size() + count > MAX_BYTES) throw new IOException("Backup exceeds size limit");
                bytes.write(buffer, 0, count);
            }
            if (bytes.size() == 0) throw new IOException("Backup cache is empty");
            return bytes.toByteArray();
        }
    }

    private void deletePending(PluginCall call) {
        try { pendingFile(call).delete(); }
        catch (IOException | RuntimeException ignored) { /* The OS can reclaim unavailable cache files. */ }
    }

    @ActivityCallback
    private void documentCreated(PluginCall call, ActivityResult result) {
        if (call == null) {
            saving.set(false);
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK) {
            deletePending(call);
            saving.set(false);
            call.resolve(new JSObject().put("saved", false));
            return;
        }
        Intent data = result.getData();
        Uri destination = data == null ? null : data.getData();
        if (destination == null || !"content".equals(destination.getScheme())) {
            deletePending(call);
            saving.set(false);
            call.reject("未取得有效的备份保存位置或内容。", "INVALID_DOCUMENT");
            return;
        }

        // A document provider can be slow. Keep its I/O off the Android UI thread.
        getBridge().execute(() -> {
            try {
                byte[] bytes = readPending(call);
                try (OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                    if (output == null) throw new IOException("No output stream for the selected document");
                    output.write(bytes);
                    output.flush();
                }
            } catch (IOException | RuntimeException error) {
                call.reject("备份未能保存，请重新选择保存位置。", "WRITE_FAILED", error);
                return;
            } finally {
                deletePending(call);
                saving.set(false);
            }
            call.resolve(new JSObject().put("saved", true));
        });
    }
}
