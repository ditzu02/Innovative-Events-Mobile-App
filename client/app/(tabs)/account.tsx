import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "@/context/auth";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { isAdminEmail } from "@/constants/config";
import { clearDiscoverPrefs, clearTasteProfilePrefs } from "@/lib/demo-prefs";

const PALETTE = {
  background: "#0b0a12",
  surface: "#151321",
  surfaceAlt: "#1c1930",
  line: "#2c2740",
  text: "#f5f3ff",
  muted: "#a2a1b4",
  accent: "#8f6bff",
  accentSoft: "#2b2446",
  danger: "#ff6b6b",
  success: "#6ee7b7",
};

export default function AccountScreen() {
  const { user, isAuthed, authLoading, signIn, signUp, signOut, updateProfile } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name ?? "");
      setAvatarUrl(user.avatar_url ?? "");
    }
  }, [user]);

  const handleAuth = async () => {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      if (mode === "login") {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password, displayName.trim() || undefined);
      }
      setPassword("");
      setSuccess(mode === "login" ? "Signed in." : "Account created.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to authenticate";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateProfile = async () => {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: {
        display_name?: string;
        avatar_url?: string;
        password_current?: string;
        password_new?: string;
      } = {};
      if (displayName.trim()) payload.display_name = displayName.trim();
      if (avatarUrl.trim()) payload.avatar_url = avatarUrl.trim();
      if (currentPassword && newPassword) {
        payload.password_current = currentPassword;
        payload.password_new = newPassword;
      }
      if (Object.keys(payload).length === 0) {
        setError("Add a display name, avatar, or password change first.");
        return;
      }
      await updateProfile(payload);
      setCurrentPassword("");
      setNewPassword("");
      setSuccess("Profile updated.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update profile";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetDemo = async () => {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await clearDiscoverPrefs();
      await clearTasteProfilePrefs();
      setSuccess("Demo preferences reset.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to reset demo preferences";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <Text style={styles.title}>Account</Text>
        <Text style={styles.muted}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Account</Text>

      {!isAuthed && (
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <Pressable
              onPress={() => setMode("login")}
              style={[styles.toggleButton, mode === "login" && styles.toggleButtonActive]}
            >
              <Text style={styles.toggleText}>Sign in</Text>
            </Pressable>
            <Pressable
              onPress={() => setMode("register")}
              style={[styles.toggleButton, mode === "register" && styles.toggleButtonActive]}
            >
              <Text style={styles.toggleText}>Create account</Text>
            </Pressable>
          </View>

          <TextInput
            placeholder="Email"
            placeholderTextColor={PALETTE.muted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />
          <TextInput
            placeholder="Password"
            placeholderTextColor={PALETTE.muted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
          />
          {mode === "register" && (
            <TextInput
              placeholder="Display name (optional)"
              placeholderTextColor={PALETTE.muted}
              value={displayName}
              onChangeText={setDisplayName}
              style={styles.input}
            />
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            onPress={handleAuth}
            disabled={submitting}
            style={({ pressed }) => [
              styles.primaryButton,
              (pressed || submitting) && { opacity: 0.8 },
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {submitting ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
            </Text>
          </Pressable>
        </View>
      )}

        {isAuthed && user && (
          <View style={styles.card}>
          <Text style={styles.sectionTitle}>Signed in</Text>
          <Text style={styles.body}>{user.display_name || "Unnamed user"}</Text>
          <Text style={styles.muted}>{user.email}</Text>

          <Text style={styles.sectionTitle}>Profile</Text>
          <TextInput
            placeholder="Display name"
            placeholderTextColor={PALETTE.muted}
            value={displayName}
            onChangeText={setDisplayName}
            style={styles.input}
          />
          <TextInput
            placeholder="Avatar URL"
            placeholderTextColor={PALETTE.muted}
            value={avatarUrl}
            onChangeText={setAvatarUrl}
            style={styles.input}
          />
          <Text style={styles.sectionTitle}>Change password</Text>
          <TextInput
            placeholder="Current password"
            placeholderTextColor={PALETTE.muted}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            style={styles.input}
          />
          <TextInput
            placeholder="New password"
            placeholderTextColor={PALETTE.muted}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            style={styles.input}
          />

          {error && <Text style={styles.error}>{error}</Text>}
          {success && <Text style={styles.success}>{success}</Text>}

          <Pressable
            onPress={handleUpdateProfile}
            disabled={submitting}
            style={({ pressed }) => [
              styles.primaryButton,
              (pressed || submitting) && { opacity: 0.8 },
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {submitting ? "Saving…" : "Update profile"}
            </Text>
          </Pressable>

          <Pressable
            onPress={signOut}
            style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </Pressable>
          <Pressable
            onPress={handleResetDemo}
            disabled={submitting}
            style={({ pressed }) => [styles.secondaryButton, (pressed || submitting) && { opacity: 0.8 }]}
          >
            <Text style={styles.secondaryButtonText}>Reset demo state</Text>
          </Pressable>
          {isAdminEmail(user.email) && (
            <Pressable
              onPress={() => router.push("/admin/taxonomy")}
              style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.secondaryButtonText}>Admin taxonomy</Text>
            </Pressable>
          )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: PALETTE.background },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: "700", color: PALETTE.text },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: PALETTE.text, marginTop: 12 },
  body: { color: PALETTE.text, fontSize: 15, marginTop: 4 },
  muted: { color: PALETTE.muted, fontSize: 13 },
  card: {
    backgroundColor: PALETTE.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  toggleRow: { flexDirection: "row", gap: 8 },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: PALETTE.surfaceAlt,
    alignItems: "center",
  },
  toggleButtonActive: {
    backgroundColor: PALETTE.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.accent,
  },
  toggleText: { color: PALETTE.text, fontWeight: "600" },
  input: {
    backgroundColor: PALETTE.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: PALETTE.text,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  primaryButton: {
    backgroundColor: PALETTE.accent,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonText: { color: "#0b0a12", fontWeight: "700" },
  secondaryButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: PALETTE.surfaceAlt,
  },
  secondaryButtonText: { color: PALETTE.text, fontWeight: "600" },
  error: { color: PALETTE.danger, fontSize: 13 },
  success: { color: PALETTE.success, fontSize: 13 },
});
