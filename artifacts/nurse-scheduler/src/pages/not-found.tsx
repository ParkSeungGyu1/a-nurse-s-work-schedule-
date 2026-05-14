import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gray-50">
      <Card className="mx-4 w-full max-w-md">
        <CardContent className="pt-6">
          <div className="mb-4 flex gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">페이지를 찾을 수 없습니다.</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            주소가 올바른지 확인하거나 왼쪽 메뉴에서 다시 이동해주세요.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
