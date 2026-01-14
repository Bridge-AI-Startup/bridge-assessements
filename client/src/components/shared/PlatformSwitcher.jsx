import { useNavigate, useLocation } from "react-router-dom";
import { ChevronDown, Building2, Github } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import bridgeLogo from "@/assets/bridge-logo.svg";

export default function PlatformSwitcher() {
  const navigate = useNavigate();
  const location = useLocation();

  // Determine current platform based on route
  const isGithubPlatform = location.pathname.startsWith("/github");
  const currentPlatform = isGithubPlatform ? "github" : "assessments";

  const platforms = [
    {
      id: "assessments",
      name: "Bridge Assessments",
      description: "AI-Powered Technical Hiring",
      icon: Building2,
      path: "/",
    },
    {
      id: "github",
      name: "Bridge GitHub Analyser",
      description: "GitHub Profile Analysis",
      icon: Github,
      path: "/github",
    },
  ];

  const handlePlatformSwitch = (platform) => {
    navigate(platform.path);
  };

  // Get current platform info
  const currentPlatformInfo = platforms.find((p) => p.id === currentPlatform);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 hover:opacity-80 transition-opacity focus:outline-none">
          <img src={bridgeLogo} alt="Bridge" className="h-8 w-8" />
          <span className="font-semibold text-sm text-gray-900">
            {currentPlatformInfo?.name || "Bridge"}
          </span>
          <ChevronDown className="h-4 w-4 text-gray-600" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {platforms.map((platform) => {
          const Icon = platform.icon;
          const isActive = currentPlatform === platform.id;

          return (
            <DropdownMenuItem
              key={platform.id}
              onClick={() => handlePlatformSwitch(platform)}
              className={`cursor-pointer ${
                isActive ? "bg-gray-100" : ""
              }`}
            >
              <div className="flex items-start gap-3 w-full">
                <Icon className="h-5 w-5 mt-0.5 text-gray-600" />
                <div className="flex-1">
                  <div className="font-medium text-sm">{platform.name}</div>
                  <div className="text-xs text-gray-500">
                    {platform.description}
                  </div>
                </div>
                {isActive && (
                  <div className="h-2 w-2 rounded-full bg-green-500 mt-1.5" />
                )}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
