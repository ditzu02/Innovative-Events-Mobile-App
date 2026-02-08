import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { request } from "@/lib/api";
import { useAuth } from "@/context/auth";
import { isAdminEmail } from "@/constants/config";

type TaxonomyTag = {
  id: string;
  name: string;
  slug: string;
  event_count: number;
};

type TaxonomySubcategory = {
  id: string;
  name: string;
  slug: string;
  tag_count: number;
  event_count: number;
  tags: TaxonomyTag[];
};

type TaxonomyCategory = {
  id: string;
  name: string;
  slug: string;
  event_count: number;
  subcategories: TaxonomySubcategory[];
};

type AdminTaxonomyResponse = {
  taxonomy_version: string;
  taxonomy: {
    categories: TaxonomyCategory[];
  };
};

const PALETTE = {
  background: "#0b0a12",
  surface: "#151321",
  line: "#2c2740",
  text: "#f5f3ff",
  muted: "#a2a1b4",
  accent: "#8f6bff",
  danger: "#ff6b6b",
};

export default function AdminTaxonomyScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<AdminTaxonomyResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isAdminEmail(user?.email)) {
        setError("Forbidden");
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const data = await request<AdminTaxonomyResponse>("/api/admin/taxonomy", { timeoutMs: 12000 });
        if (cancelled) return;
        setPayload(data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Unable to fetch taxonomy";
        setError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
        <Text style={styles.title}>Admin Taxonomy</Text>
        {payload?.taxonomy_version && (
          <Text style={styles.subtitle}>Version: {payload.taxonomy_version}</Text>
        )}

        {loading && (
          <View style={styles.card}>
            <ActivityIndicator size="small" color={PALETTE.accent} />
            <Text style={styles.subtitle}>Loading taxonomy...</Text>
          </View>
        )}

        {!loading && error && (
          <View style={styles.card}>
            <Text style={styles.error}>{error}</Text>
          </View>
        )}

        {!loading &&
          !error &&
          payload?.taxonomy?.categories?.map((category) => (
            <View key={category.id} style={styles.card}>
              <Text style={styles.categoryTitle}>
                {category.name} ({category.event_count})
              </Text>
              {category.subcategories.map((subcategory) => (
                <View key={subcategory.id} style={styles.subcategoryBlock}>
                  <Text style={styles.subcategoryTitle}>
                    {subcategory.name} ({subcategory.event_count}) · tags {subcategory.tag_count}
                  </Text>
                  <View style={styles.tagsWrap}>
                    {subcategory.tags.map((tag) => (
                      <View key={tag.id} style={styles.tagBadge}>
                        <Text style={styles.tagText}>
                          {tag.name} ({tag.event_count})
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: PALETTE.background },
  container: { padding: 16, gap: 12, paddingBottom: 24 },
  title: { fontSize: 22, fontWeight: "700", color: PALETTE.text },
  subtitle: { fontSize: 13, color: PALETTE.muted },
  error: { color: PALETTE.danger, fontSize: 13 },
  card: {
    backgroundColor: PALETTE.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
    gap: 8,
  },
  categoryTitle: { fontSize: 15, fontWeight: "700", color: PALETTE.text },
  subcategoryBlock: { gap: 6, marginTop: 4 },
  subcategoryTitle: { fontSize: 13, color: PALETTE.muted, fontWeight: "600" },
  tagsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "#2b2446",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PALETTE.line,
  },
  tagText: { color: PALETTE.accent, fontSize: 12 },
});
