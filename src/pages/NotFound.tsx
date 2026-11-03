import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Home, Zap } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <Helmet>
        <title>Page not found | ACA</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="text-center space-y-6">
        <div>
          <h1 className="mb-4 text-6xl font-bold">404</h1>
          <p className="mb-2 text-xl text-muted-foreground">Oops! Page not found</p>
          <p className="text-sm text-muted-foreground">The page you're looking for doesn't exist.</p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button asChild>
            <Link to="/jobs">
              <Home className="h-4 w-4 mr-2" />
              Mission Control
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/create">
              <Zap className="h-4 w-4 mr-2" />
              Create Content
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
