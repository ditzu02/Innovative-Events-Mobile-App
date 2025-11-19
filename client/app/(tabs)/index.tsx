import { useEffect, useState } from "react";
import { View, Text } from "react-native";

export default function Home() {
  const [dbResponse, setDbResponse] = useState<any>(null);

  useEffect(() => {
    async function testBackend() {
      try {
        const response = await fetch("http://192.168.31.18:5000/api/test-db");
        const data = await response.json();
        setDbResponse(data);
        console.log("Backend response:", data);
      } catch (error) {
        console.error("Fetch error:", error);
      }
    }
    
    testBackend();
  }, []);

  return (
    <View style={{ padding: 20 }}>
      <Text style={{ fontSize: 20, fontWeight: "bold" }}>
        Backend Test:
      </Text>

      <Text>{JSON.stringify(dbResponse, null, 2)}</Text>
    </View>
  );
}
